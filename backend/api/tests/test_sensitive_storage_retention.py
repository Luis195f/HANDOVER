import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from backend.api.clinical_storage import ENCRYPTED_BUNDLE_MARKER, decrypt_bundle_document, encrypt_bundle_document
from backend.api.icea_payload_mapper import build_icea_bridge_payload
from backend.api.models import (
    HandoverBundleRecord,
    IceaBridgeRequest,
    IceaOutboundEvent,
    IceaPipelineEvent,
    IceaPipelineSnapshot,
)
from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response, build_icea_bundle


class SensitiveBundleStorageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        authenticate_api_client(self.client, sub='auth0|storage-nurse')
        self.tx_url = reverse('fhir-transaction')
        self.read_url = reverse('handover-etl-read', kwargs={'bundle_id': 'bundle-sensitive-001'})
        self.bundle = {
            'resourceType': 'Bundle',
            'id': 'bundle-sensitive-001',
            'type': 'transaction',
            'entry': [
                {
                    'request': {'method': 'POST', 'url': 'Patient'},
                    'resource': {
                        'resourceType': 'Patient',
                        'id': 'patient-sensitive-001',
                        'name': [{'family': 'Sensitive', 'given': ['Paciente']}],
                    },
                }
            ],
        }

    def _auth_etl(self):
        claims = {
            'sub': 'auth0|svc-etl',
            'roles': ['service_etl'],
            'permissions': ['handover:etl:read'],
            'scope': 'handover:etl:read',
            'gty': 'client-credentials',
        }
        user = type('User', (), {'is_authenticated': True, 'claims': claims, 'sub': 'auth0|svc-etl', 'username': 'svc'})()
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer etl-token', HTTP_X_UNIT_ID='icu-a')

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_transaction_persists_encrypted_bundle_and_etl_reads_decrypted_payload(self, mock_post):
        mock_post.return_value = build_fhir_response()

        response = self.client.post(
            self.tx_url,
            data=self.bundle,
            format='json',
            HTTP_X_REQUEST_ID='req-sensitive-001',
        )

        self.assertEqual(response.status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='req-sensitive-001')
        self.assertEqual(record.bundle_json.get('_storage'), ENCRYPTED_BUNDLE_MARKER)
        self.assertEqual(record.encryption_metadata.get('at_rest'), 'application-aes-256-gcm')
        persisted_text = json.dumps(record.bundle_json, ensure_ascii=False)
        self.assertNotIn('Paciente', persisted_text)
        self.assertNotIn('patient-sensitive-001', persisted_text)

        self._auth_etl()
        read_response = self.client.get(self.read_url)

        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(json.loads(read_response.content), decrypt_bundle_document(record.bundle_json))
        self.assertEqual(read_response['Cache-Control'], 'private, no-store')
        self.assertIn('Authorization', [value.strip() for value in read_response['Vary'].split(',')])


    @override_settings(SECRET_KEY='legacy-secret-key', HANDOVER_BUNDLE_ENCRYPTION_KEY='')
    def test_legacy_secret_key_bundle_remains_readable_after_env_key_is_enabled(self):
        encrypted_bundle, metadata = encrypt_bundle_document(self.bundle)

        self.assertEqual(metadata['key_source'], 'secret_key_derived')

        with override_settings(SECRET_KEY='legacy-secret-key', HANDOVER_BUNDLE_ENCRYPTION_KEY='env-bundle-key'):
            self.assertEqual(
                decrypt_bundle_document(encrypted_bundle, encryption_metadata=metadata),
                self.bundle,
            )

    @override_settings(SECRET_KEY='legacy-secret-key', HANDOVER_BUNDLE_ENCRYPTION_KEY='env-bundle-key')
    def test_env_key_bundle_round_trips_with_metadata(self):
        encrypted_bundle, metadata = encrypt_bundle_document(self.bundle)

        self.assertEqual(metadata['key_source'], 'env')
        self.assertEqual(
            decrypt_bundle_document(encrypted_bundle, encryption_metadata=metadata),
            self.bundle,
        )

    def test_expired_bundle_is_deleted_before_etl_read(self):
        encrypted_bundle, metadata = encrypt_bundle_document(self.bundle)
        record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-sensitive-001',
            patient_id='patient-sensitive-001',
            unit_id='icu-a',
            request_id='req-sensitive-expired',
            bundle_json=encrypted_bundle,
            encryption_metadata=metadata,
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        self._auth_etl()
        response = self.client.get(self.read_url)

        self.assertEqual(response.status_code, 404)
        self.assertFalse(HandoverBundleRecord.objects.filter(id=record.id).exists())


class SensitiveRetentionPruningTests(TestCase):
    def test_prune_sensitive_records_removes_expired_and_terminal_artifacts_only(self):
        old = timezone.now() - timedelta(days=3)
        encrypted_bundle, metadata = encrypt_bundle_document(build_icea_bundle(bundle_id='bundle-prune-001'))
        HandoverBundleRecord.objects.create(
            bundle_id='bundle-prune-001',
            patient_id='pat-prune-001',
            unit_id='icu-a',
            request_id='req-prune-001',
            bundle_json=encrypted_bundle,
            encryption_metadata=metadata,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        delivered = IceaOutboundEvent.objects.create(
            request_id='req-outbox-delivered',
            idempotency_key='req-outbox-delivered',
            bundle_id='bundle-prune-001',
            patient_id='pat-prune-001',
            unit_id='icu-a',
            payload_json={'bundleId': 'bundle-prune-001'},
            status=IceaOutboundEvent.STATUS_DELIVERED,
        )
        retry = IceaOutboundEvent.objects.create(
            request_id='req-outbox-retry',
            idempotency_key='req-outbox-retry',
            bundle_id='bundle-prune-002',
            patient_id='pat-prune-002',
            unit_id='icu-a',
            payload_json={'bundleId': 'bundle-prune-002'},
            status=IceaOutboundEvent.STATUS_RETRY,
        )
        scored = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-prune:immediate_provisional',
            request_id='req-bridge-prune',
            bundle_id='bundle-prune-001',
            patient_id='pat-prune-001',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-prune:immediate_provisional:abcd',
            payload_hash='abcd' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_SCORED,
        )
        pending = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-pending:immediate_provisional',
            request_id='req-bridge-pending',
            bundle_id='bundle-prune-003',
            patient_id='pat-prune-003',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-pending:immediate_provisional:efgh',
            payload_hash='efgh' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_PENDING,
        )
        snapshot = IceaPipelineSnapshot.objects.create(
            request_id='req-snapshot-prune',
            bundle_id='bundle-prune-001',
            patient_id='pat-prune-001',
            unit_id='icu-a',
            visible_status=IceaPipelineSnapshot.STATUS_SUCCEEDED,
            last_stage='normalize',
            stage_statuses={'normalize': {'status': 'succeeded'}},
        )
        running_snapshot = IceaPipelineSnapshot.objects.create(
            request_id='req-snapshot-running',
            bundle_id='bundle-prune-004',
            patient_id='pat-prune-004',
            unit_id='icu-a',
            visible_status=IceaPipelineSnapshot.STATUS_RUNNING,
            last_stage='normalize',
            stage_statuses={'normalize': {'status': 'running'}},
        )
        event = IceaPipelineEvent.objects.create(
            request_id='req-event-prune',
            bundle_id='bundle-prune-001',
            patient_id='pat-prune-001',
            unit_id='icu-a',
            stage='normalize',
            status='succeeded',
            source='manual-action',
        )

        IceaOutboundEvent.objects.filter(id=delivered.id).update(created_at=old)
        IceaOutboundEvent.objects.filter(id=retry.id).update(created_at=old)
        IceaBridgeRequest.objects.filter(id=scored.id).update(updated_at=old)
        IceaBridgeRequest.objects.filter(id=pending.id).update(updated_at=old)
        IceaPipelineSnapshot.objects.filter(id=snapshot.id).update(updated_at=old)
        IceaPipelineSnapshot.objects.filter(id=running_snapshot.id).update(updated_at=old)
        IceaPipelineEvent.objects.filter(id=event.id).update(created_at=old)

        call_command('prune_sensitive_records', bundle_days=1, technical_days=1)

        self.assertFalse(HandoverBundleRecord.objects.filter(request_id='req-prune-001').exists())
        self.assertFalse(IceaOutboundEvent.objects.filter(id=delivered.id).exists())
        self.assertTrue(IceaOutboundEvent.objects.filter(id=retry.id).exists())
        self.assertFalse(IceaBridgeRequest.objects.filter(id=scored.id).exists())
        self.assertTrue(IceaBridgeRequest.objects.filter(id=pending.id).exists())
        self.assertFalse(IceaPipelineSnapshot.objects.filter(id=snapshot.id).exists())
        self.assertTrue(IceaPipelineSnapshot.objects.filter(id=running_snapshot.id).exists())
        self.assertFalse(IceaPipelineEvent.objects.filter(id=event.id).exists())


class IceaBridgePayloadMinimizationTests(TestCase):
    def test_bridge_payload_drops_free_text_diagnosis_labels_and_risk_names(self):
        bundle = build_icea_bundle(bundle_id='bundle-min-001', patient_id='pat-min-001', unit_id='icu-a')
        bundle['entry'].append(
            {
                'resource': {
                    'resourceType': 'Condition',
                    'category': [{'coding': [{'display': 'Risk'}]}],
                    'code': {
                        'text': 'Fall risk',
                        'coding': [{'system': 'http://snomed.info/sct', 'code': '248244005', 'display': 'Risk for falls'}],
                    },
                }
            }
        )

        payload = build_icea_bridge_payload(
            bundle,
            request_id='req-min-001',
            scoring_mode='immediate_provisional',
            unit_id='icu-a',
        )

        self.assertNotIn('display', payload['caseMix']['diagnoses'][0])
        self.assertEqual(payload['caseMix']['riskFlags'], ['248244005'])
        self.assertNotIn('Fall risk', json.dumps(payload, ensure_ascii=False))

