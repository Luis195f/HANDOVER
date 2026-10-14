import copy
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event
from unittest.mock import Mock, patch

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management import call_command
from django.db import OperationalError, connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from backend.api.models import HandoverBundleRecord
from backend.api.clinical_storage import decrypt_bundle_document
from backend.api.icea_transaction import claim_transaction_effects
from backend.api.tests.icea_test_utils import (
    authenticate_api_client,
    build_fhir_response,
    build_icea_bundle,
)
from backend.audit.models import AuditEvent
from backend.signature import SignatureSettings, sign_bundle


class FhirTransactionIdempotencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse('fhir-transaction')
        authenticate_api_client(self.client, sub='auth0|nurse-c04', unit_ids=['icu-a'])
        self.bundle = build_icea_bundle(bundle_id='bundle-c04-001', patient_id='pat-c04-001', unit_id='icu-a')
        audit_patch = patch('backend.api.views._create_audit_event_for_transaction')
        audit_patch.start()
        self.addCleanup(audit_patch.stop)

    def post_bundle(self, bundle=None, *, key='c04-request-001'):
        return self.client.post(
            self.url,
            data=bundle or self.bundle,
            format='json',
            HTTP_IDEMPOTENCY_KEY=key,
            HTTP_X_UNIT_ID='icu-a',
        )

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_intent_precedes_send_and_confirmed_replay_does_not_resend(self, mock_post):
        def send(*_args, **_kwargs):
            record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
            self.assertIn(record.status, ('pending', 'unknown'))
            return build_fhir_response()

        mock_post.side_effect = send
        first = self.post_bundle()
        replay = self.post_bundle()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(mock_post.call_count, 1)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertEqual(record.status, 'succeeded')
        self.assertEqual(record.response_json['_storage'], 'handover_bundle_encrypted_v1')
        self.assertEqual(decrypt_bundle_document(record.response_json, encryption_metadata=record.encryption_metadata), first.data)

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_confirmed_replay_does_not_require_remote_validation(self, mock_post):
        with patch('backend.api.views._validate_remotely', return_value=None) as mock_validate:
            self.assertEqual(self.post_bundle().status_code, 201)
        mock_validate.assert_called_once()
        with patch('backend.api.views._validate_remotely', side_effect=AssertionError('remote validation unavailable')):
            self.assertEqual(self.post_bundle().status_code, 201)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_same_key_different_bundle_is_explicit_conflict_without_send(self, mock_post):
        first = self.post_bundle()
        changed = copy.deepcopy(self.bundle)
        changed['entry'][0]['resource']['id'] = 'pat-c04-different'
        second = self.post_bundle(changed)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data['code'], 'idempotency_conflict')
        mock_post.assert_called_once()
        audit = AuditEvent.objects.filter(http_status=409).get()
        self.assertEqual(audit.user_sub, 'auth0|nurse-c04')
        self.assertEqual(audit.meta['errorCode'], 'IDEMPOTENCY_CONFLICT')
        self.assertNotIn('pat-c04', json.dumps(audit.meta))

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_lost_response_remains_unknown_and_never_resends_automatically(self, mock_post):
        mock_post.side_effect = httpx.ReadTimeout('response lost')
        first = self.post_bundle()
        second = self.post_bundle()

        self.assertEqual(first.status_code, 503)
        self.assertEqual(second.status_code, 503)
        self.assertEqual(second.data['code'], 'transaction_unknown')
        self.assertEqual(mock_post.call_count, 1)
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').status, 'unknown')

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_resigned_transport_replay_keeps_logical_hash_and_unknown_intent(self, mock_post):
        bundle = copy.deepcopy(self.bundle)
        bundle['entry'][2]['resource']['status'] = 'preliminary'
        bundle.pop('signature', None)
        marker = {'system': 'urn:handover:transaction-composition', 'value': 'handover:c04-resigned'}
        bundle['entry'][2]['resource']['identifier'] = marker
        original = copy.deepcopy(bundle)
        with tempfile.TemporaryDirectory() as directory:
            private_key = ec.generate_private_key(ec.SECP256R1())
            private_path = Path(directory) / 'private.pem'
            public_path = Path(directory) / 'public.pem'
            private_path.write_bytes(private_key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
            ))
            public_path.write_bytes(private_key.public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
            ))
            settings = SignatureSettings(str(private_path), str(public_path), False)
            first = copy.deepcopy(bundle)
            second = copy.deepcopy(bundle)
            first['signature'] = sign_bundle(bundle, user_id='auth0|nurse-c04', settings=settings).fhir_signature
            second['signature'] = sign_bundle(bundle, user_id='auth0|nurse-c04', settings=settings).fhir_signature
            self.assertNotEqual(first['signature']['data'], second['signature']['data'])
            mock_post.side_effect = httpx.ReadTimeout('response lost')
            capability = Mock(status_code=200)
            capability.json.return_value = {'rest': [{'mode': 'server', 'resource': [
                {'type': 'Composition', 'searchParam': [{'name': 'identifier'}]},
            ]}]}
            search = Mock(status_code=200)
            search.json.return_value = {'resourceType': 'Bundle', 'total': 1, 'entry': [
                {'resource': {'resourceType': 'Composition', 'id': 'remote-resigned', 'identifier': marker}},
            ]}
            with patch('backend.api.views.SIGNATURE_SETTINGS', settings):
                first_response = self.post_bundle(first)
                with patch('backend.api.views.httpx.get', side_effect=[capability, search]):
                    second_response = self.post_bundle(second)
        self.assertEqual(first_response.data['code'], 'transaction_unknown')
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(second_response.data['type'], 'transaction-response')
        self.assertEqual(first, {**original, 'signature': first['signature']})
        self.assertEqual(second, {**original, 'signature': second['signature']})
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_clinical_signature_change_conflicts_even_with_same_request_key(self, mock_post):
        self.assertEqual(self.post_bundle().status_code, 201)
        changed = copy.deepcopy(self.bundle)
        changed['signature'][0]['data'] = 'different-clinical-rubric'
        self.assertEqual(self.post_bundle(changed).data['code'], 'idempotency_conflict')
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_succeeded_replay_recovers_effects_after_interrupted_completion(self, mock_post):
        with patch('backend.api.views._complete_transaction_side_effects', side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError):
                self.post_bundle()
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertEqual(record.status, 'succeeded')
        self.assertTrue(record.effects_pending)
        with patch('backend.api.views._complete_transaction_side_effects') as mock_complete:
            self.assertEqual(self.post_bundle().status_code, 201)
        mock_complete.assert_called_once()
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_swallowed_snapshot_failure_remains_pending_then_replay_completes_once(self, mock_post):
        with patch('backend.api.views.ensure_pipeline_snapshot_from_bundle', side_effect=RuntimeError('storage')):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_pending)
        self.assertFalse(record.effects_completed.get('icea'))
        closure_count = AuditEvent.objects.filter(event_type='handover_closure_attestation').count()
        self.assertEqual(self.post_bundle().status_code, 201)
        record.refresh_from_db()
        self.assertFalse(record.effects_pending)
        self.assertEqual(AuditEvent.objects.filter(event_type='handover_closure_attestation').count(), closure_count)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_failed_fhir_audit_stays_pending_and_replays_without_clinical_post(self, mock_post):
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=False):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_pending)
        self.assertTrue(record.effects_completed.get('icea'))
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=True) as mock_audit:
            self.assertEqual(self.post_bundle().status_code, 201)
        record.refresh_from_db()
        self.assertFalse(record.effects_pending)
        mock_audit.assert_called_once()
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_concurrent_succeeded_replay_claims_effects_once(self, mock_post):
        with patch('backend.api.views.persist_successful_transaction_icea_side_effects', side_effect=RuntimeError('pause')):
            self.assertEqual(self.post_bundle().status_code, 201)
        from backend.api import views

        real_effects = views.persist_successful_transaction_icea_side_effects

        def complete_with_overlap(*args, **kwargs):
            self.assertEqual(self.post_bundle().status_code, 201)
            return real_effects(*args, **kwargs)

        with patch('backend.api.views.persist_successful_transaction_icea_side_effects', side_effect=complete_with_overlap) as effects:
            self.assertEqual(self.post_bundle().status_code, 201)
        self.assertEqual(effects.call_count, 1)
        self.assertFalse(HandoverBundleRecord.objects.get(request_id='c04-request-001').effects_pending)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_worker_recovers_local_effects_after_confirmation_without_client_replay(self, mock_post):
        with patch('backend.api.views.ensure_pipeline_snapshot_from_bundle', side_effect=RuntimeError('temporary storage')):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_pending)
        self.assertEqual(record.accepted_actor_sub, 'auth0|nurse-c04')

        call_command('recover_transaction_effects')

        record.refresh_from_db()
        self.assertFalse(record.effects_pending)
        self.assertTrue(record.effects_completed['icea'])
        self.assertEqual(record.effects_attempts, 0)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_worker_recovers_after_exit_immediately_following_succeeded(self, mock_post):
        with patch('backend.api.views._complete_transaction_side_effects', side_effect=RuntimeError('worker exited')):
            with self.assertRaises(RuntimeError):
                self.post_bundle()
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertEqual(record.status, 'succeeded')
        self.assertTrue(record.effects_pending)

        call_command('recover_transaction_effects')

        record.refresh_from_db()
        self.assertTrue(record.effects_completed['icea'])
        self.assertTrue(record.effects_pending)
        self.assertEqual(record.effects_last_error, 'fhir_service_credentials_unavailable')
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_worker_retries_partial_failure_with_backoff_and_no_duplicate_send(self, mock_post):
        with patch('backend.api.views.ensure_pipeline_snapshot_from_bundle', side_effect=RuntimeError('temporary storage')):
            self.assertEqual(self.post_bundle().status_code, 201)
            call_command('recover_transaction_effects')
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_pending)
        self.assertEqual(record.effects_attempts, 1)
        self.assertGreater(record.effects_next_retry_at, timezone.now())
        call_command('recover_transaction_effects')
        record.refresh_from_db()
        self.assertEqual(record.effects_attempts, 1)
        HandoverBundleRecord.objects.filter(pk=record.pk).update(effects_next_retry_at=timezone.now() - timezone.timedelta(seconds=1))

        call_command('recover_transaction_effects')

        record.refresh_from_db()
        self.assertFalse(record.effects_pending)
        self.assertTrue(record.effects_completed['icea'])
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_stale_lease_is_recovered_but_active_lease_is_not_stolen(self, mock_post):
        with patch('backend.api.views.ensure_pipeline_snapshot_from_bundle', side_effect=RuntimeError('temporary storage')):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        HandoverBundleRecord.objects.filter(pk=record.pk).update(effects_claimed_at=timezone.now())
        call_command('recover_transaction_effects')
        record.refresh_from_db()
        self.assertTrue(record.effects_pending)
        HandoverBundleRecord.objects.filter(pk=record.pk).update(
            effects_claimed_at=timezone.now() - timezone.timedelta(minutes=6),
        )
        call_command('recover_transaction_effects')
        record.refresh_from_db()
        self.assertFalse(record.effects_pending)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_worker_without_human_session_blocks_external_audit_but_recovers_local_effects(self, mock_post):
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=False) as audit:
            self.assertEqual(self.post_bundle().status_code, 201)
            self.assertEqual(audit.call_count, 1)
            call_command('recover_transaction_effects')
            self.assertEqual(audit.call_count, 1)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_completed['icea'])
        self.assertTrue(record.effects_pending)
        self.assertEqual(record.effects_last_error, 'fhir_service_credentials_unavailable')
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_worker_counts_a_failed_claimed_attempt_only_once(self, mock_post):
        with patch('backend.api.views._emit_bundle_audit'):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertTrue(record.effects_pending)

        with patch('backend.api.views._emit_bundle_audit', side_effect=RuntimeError('temporary audit storage')):
            call_command('recover_transaction_effects')

        record.refresh_from_db()
        self.assertEqual(record.effects_attempts, 1)
        self.assertGreater(record.effects_next_retry_at, timezone.now())
        self.assertTrue(record.effects_pending)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_original_actor_remains_a_when_authorized_b_replays(self, mock_post):
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=False):
            self.assertEqual(self.post_bundle().status_code, 201)
        authenticate_api_client(self.client, sub='auth0|nurse-b', unit_ids=['icu-a'])
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=True) as audit:
            self.assertEqual(self.post_bundle().status_code, 201)
        self.assertEqual(audit.call_args.kwargs['user_id'], 'auth0|nurse-c04')
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').accepted_actor_sub, 'auth0|nurse-c04')
        self.assertTrue(AuditEvent.objects.filter(user_sub='auth0|nurse-b', meta__errorCode='TRANSACTION_REPLAY').exists())
        mock_post.assert_called_once()

    def test_procfile_starts_a_continuous_recovery_worker(self):
        self.assertIn('worker: python manage.py recover_transaction_effects --continuous', Path('Procfile').read_text())
        call_command('recover_transaction_effects', continuous=True, max_cycles=1, interval=0)

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_legacy_intent_without_actor_is_not_attributed_to_replay_user(self, mock_post):
        with patch('backend.api.views._create_audit_event_for_transaction', return_value=False):
            self.assertEqual(self.post_bundle().status_code, 201)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        HandoverBundleRecord.objects.filter(pk=record.pk).update(
            accepted_actor_sub='', effects_pending=True,
            effects_completed={'icea': True, 'closure': True},
        )
        authenticate_api_client(self.client, sub='auth0|nurse-b', unit_ids=['icu-a'])
        with patch('backend.api.views._create_audit_event_for_transaction') as audit:
            self.assertEqual(self.post_bundle().status_code, 201)
            audit.assert_not_called()
        call_command('recover_transaction_effects')
        record.refresh_from_db()
        self.assertEqual(record.effects_last_error, 'original_actor_unverified')
        self.assertFalse(AuditEvent.objects.filter(
            user_sub='auth0|nurse-b', event_type='fhir_transaction', status='success',
        ).exclude(meta__errorCode='TRANSACTION_REPLAY').exists())
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response(status_code=503))
    def test_upstream_five_hundred_is_unknown_and_never_resends(self, mock_post):
        self.assertEqual(self.post_bundle().data['code'], 'transaction_unknown')
        self.assertEqual(self.post_bundle().data['code'], 'transaction_unknown')
        mock_post.assert_called_once()
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').status, 'unknown')

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_overlapping_requests_send_only_once(self, mock_post):
        overlapping = []

        def send(*_args, **_kwargs):
            overlapping.append(self.post_bundle())
            return build_fhir_response()

        mock_post.side_effect = send
        confirmed = self.post_bundle()
        self.assertEqual(overlapping[0].status_code, 503)
        self.assertEqual(confirmed.status_code, 201)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_intent_persistence_failure_prevents_external_post(self, mock_post):
        from django.db import DatabaseError

        with patch('backend.api.views.claim_transaction_intent', side_effect=DatabaseError):
            response = self.post_bundle()
        self.assertEqual(response.status_code, 503)
        mock_post.assert_not_called()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_pending_from_previous_process_is_not_assumed_unsent(self, mock_post):
        mock_post.side_effect = httpx.ReadTimeout('response lost')
        self.post_bundle()
        HandoverBundleRecord.objects.filter(request_id='c04-request-001').update(status='pending')
        self.assertEqual(self.post_bundle().data['code'], 'transaction_unknown')
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_positive_composition_evidence_recovers_without_reposting(self, mock_post):
        bundle = copy.deepcopy(self.bundle)
        marker = {'system': 'urn:handover:transaction-composition', 'value': 'handover:c04-marker'}
        bundle['entry'][2]['resource']['identifier'] = marker
        original = copy.deepcopy(bundle)
        mock_post.side_effect = httpx.ReadTimeout('response lost')
        self.assertEqual(self.post_bundle(bundle).status_code, 503)

        capability = Mock(status_code=200)
        capability.json.return_value = {'rest': [{'mode': 'server', 'resource': [
            {'type': 'Composition', 'searchParam': [{'name': 'identifier'}]},
        ]}]}
        search = Mock(status_code=200)
        search.json.return_value = {'resourceType': 'Bundle', 'total': 1, 'entry': [
            {'resource': {'resourceType': 'Composition', 'id': 'remote-c04', 'identifier': marker}},
        ]}
        with patch('backend.api.views.httpx.get', side_effect=[capability, search]) as mock_get, patch(
            'backend.api.views.persist_successful_transaction_icea_side_effects'
        ) as mock_effects:
            recovered = self.post_bundle(bundle)
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.data['entry'][0]['response']['location'], 'Composition/remote-c04')
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').status, 'succeeded')
        self.assertEqual(mock_get.call_count, 2)
        mock_post.assert_called_once()
        self.assertEqual(bundle, original)
        self.assertEqual(self.post_bundle(bundle).status_code, 200)
        mock_post.assert_called_once()
        mock_effects.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_unproven_or_failed_reconciliation_remains_unknown(self, mock_post):
        bundle = copy.deepcopy(self.bundle)
        bundle['entry'][2]['resource']['identifier'] = {
            'system': 'urn:handover:transaction-composition', 'value': 'handover:c04-marker',
        }
        mock_post.side_effect = httpx.ReadTimeout('response lost')
        self.post_bundle(bundle)
        capability = Mock(status_code=200)
        capability.json.return_value = {'rest': [{'mode': 'server', 'resource': [
            {'type': 'Composition', 'searchParam': [{'name': 'identifier'}]},
        ]}]}
        empty_search = Mock(status_code=200)
        empty_search.json.return_value = {'resourceType': 'Bundle', 'total': 0, 'entry': []}
        for search_response in (empty_search, httpx.ReadTimeout('search unavailable')):
            with patch('backend.api.views.httpx.get', side_effect=[capability, search_response]):
                self.assertEqual(self.post_bundle(bundle).data['code'], 'transaction_unknown')
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').status, 'unknown')
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_upstream_conflicts_are_cached_failures_without_second_send(self, mock_post):
        for status in (409, 412):
            with self.subTest(status=status):
                key = f'c04-conflict-{status}'
                bundle = build_icea_bundle(bundle_id=f'bundle-c04-{status}', patient_id='pat-c04-001', unit_id='icu-a')
                mock_post.return_value = build_fhir_response(status_code=status)
                first = self.post_bundle(bundle, key=key)
                second = self.post_bundle(bundle, key=key)
                self.assertEqual(first.status_code, status)
                self.assertEqual(second.status_code, status)
                self.assertEqual(HandoverBundleRecord.objects.get(request_id=key).status, 'failed')
        self.assertEqual(mock_post.call_count, 2)

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_uninterpretable_success_body_is_unknown(self, mock_post):
        mock_post.return_value = Mock(status_code=200, json=Mock(return_value={'ack': True}))
        self.assertEqual(self.post_bundle().data['code'], 'transaction_unknown')
        self.assertEqual(HandoverBundleRecord.objects.get(request_id='c04-request-001').status, 'unknown')

    @patch('backend.api.views._post_transaction_to_fhir', return_value=build_fhir_response())
    def test_replay_requires_authentication_and_unit_authorization(self, mock_post):
        self.assertEqual(self.post_bundle().status_code, 201)
        unauthenticated = APIClient()
        self.assertEqual(unauthenticated.post(
            self.url, self.bundle, format='json', HTTP_IDEMPOTENCY_KEY='c04-request-001',
        ).status_code, 401)
        self.assertEqual(self.client.post(
            self.url, self.bundle, format='json', HTTP_IDEMPOTENCY_KEY='c04-request-001',
            HTTP_X_UNIT_ID='foreign-unit',
        ).status_code, 400)
        mock_post.assert_called_once()

    @patch('backend.api.views._post_transaction_to_fhir')
    def test_retention_redacts_phi_but_preserves_unknown_replay_fence(self, mock_post):
        mock_post.side_effect = httpx.ReadTimeout('response lost')
        self.assertEqual(self.post_bundle().status_code, 503)
        record = HandoverBundleRecord.objects.get(request_id='c04-request-001')
        self.assertEqual(record.accepted_actor_sub, 'auth0|nurse-c04')
        HandoverBundleRecord.objects.filter(pk=record.pk).update(expires_at=timezone.now() - timezone.timedelta(days=1))

        call_command('prune_sensitive_records', bundle_days=1, technical_days=1)

        record.refresh_from_db()
        self.assertIsNone(record.bundle_json)
        self.assertEqual(record.patient_id, '')
        self.assertEqual(record.unit_id, '')
        self.assertEqual(record.accepted_actor_sub, '')
        self.assertTrue(record.request_id.startswith('retained:'))
        self.assertEqual(self.post_bundle().data['code'], 'transaction_unknown')
        self.assertEqual(self.post_bundle(key='c04-new-key').status_code, 409)
        mock_post.assert_called_once()


class FhirTransactionConcurrentTests(TransactionTestCase):
    def test_two_workers_cannot_claim_the_same_effects_lease(self):
        record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-c04-workers', request_id='c04-workers', patient_id='pat-c04-workers',
            unit_id='icu-a', status='succeeded', effects_pending=True,
            expires_at=HandoverBundleRecord.default_expiry(),
        )

        ready = Barrier(2)
        executed = []
        connections = []

        def claim():
            try:
                loaded = HandoverBundleRecord.objects.get(pk=record.pk)
                connections.append(id(connection.connection))
                ready.wait(timeout=5)
                claimed_at = claim_transaction_effects(loaded)
                if claimed_at is not None:
                    executed.append(claimed_at)
                return claimed_at
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            claims = list(executor.map(lambda _: claim(), range(2)))
        self.assertEqual(sum(value is not None for value in claims), 1)
        self.assertEqual(len(executed), 1)
        self.assertEqual(len(set(connections)), 2)

    def test_sqlite_lock_leaves_effects_pending_for_a_later_claim(self):
        record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-c04-locked', request_id='c04-locked', patient_id='pat-c04-locked',
            unit_id='icu-a', status='succeeded', effects_pending=True,
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        for message in ('database table is locked: api_handoverbundlerecord', 'database is locked'):
            with self.subTest(message=message):
                with patch('django.db.models.query.QuerySet.update', side_effect=OperationalError(message)):
                    self.assertIsNone(claim_transaction_effects(record))
                record.refresh_from_db()
                self.assertTrue(record.effects_pending)
                self.assertIsNone(record.effects_claimed_at)
        self.assertIsNotNone(claim_transaction_effects(record))

    def test_active_expired_and_completed_effects_leases(self):
        record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-c04-lease-states', request_id='c04-lease-states',
            patient_id='pat-c04-lease-states', unit_id='icu-a', status='succeeded',
            effects_pending=True, accepted_actor_sub='auth0|original',
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self.assertIsNotNone(claim_transaction_effects(record))
        self.assertIsNone(claim_transaction_effects(record))
        HandoverBundleRecord.objects.filter(pk=record.pk).update(
            effects_claimed_at=timezone.now() - timezone.timedelta(minutes=6),
        )
        self.assertIsNotNone(claim_transaction_effects(record))
        HandoverBundleRecord.objects.filter(pk=record.pk).update(effects_pending=False)
        self.assertIsNone(claim_transaction_effects(record))
        record.refresh_from_db()
        self.assertEqual(record.accepted_actor_sub, 'auth0|original')

    def test_unrelated_operational_error_is_not_hidden(self):
        record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-c04-db-error', request_id='c04-db-error', patient_id='pat-c04-db-error',
            unit_id='icu-a', status='succeeded', effects_pending=True,
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        for message in ('no such table', 'database table is locked: unrelated_table'):
            with self.subTest(message=message):
                with patch('django.db.models.query.QuerySet.update', side_effect=OperationalError(message)):
                    with self.assertRaisesMessage(OperationalError, message):
                        claim_transaction_effects(record)

    @patch('backend.api.views._create_audit_event_for_transaction')
    @patch('backend.api.views._post_transaction_to_fhir')
    def test_concurrent_requests_share_one_durable_intent(self, mock_post, _mock_audit):
        started = Event()
        release = Event()
        bundle = build_icea_bundle(bundle_id='bundle-c04-concurrent', patient_id='pat-c04-concurrent', unit_id='icu-a')

        def post():
            client = APIClient()
            authenticate_api_client(client, sub='auth0|nurse-c04', unit_ids=['icu-a'])
            return client.post(
                reverse('fhir-transaction'), bundle, format='json',
                HTTP_IDEMPOTENCY_KEY='c04-concurrent', HTTP_X_UNIT_ID='icu-a',
            )

        def send(*_args, **_kwargs):
            started.set()
            if not release.wait(10):
                raise httpx.ReadTimeout('test transport stalled')
            return build_fhir_response()

        mock_post.side_effect = send
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_future = executor.submit(post)
            try:
                self.assertTrue(started.wait(10))
                second = executor.submit(post).result(timeout=10)
                self.assertEqual(second.status_code, 503)
                self.assertEqual(second.data['code'], 'transaction_unknown')
            finally:
                release.set()
            self.assertEqual(first_future.result(timeout=10).status_code, 201)

        mock_post.assert_called_once()
        self.assertEqual(HandoverBundleRecord.objects.filter(request_id='c04-concurrent').count(), 1)


class FhirTransactionMigrationTests(TransactionTestCase):
    def test_existing_successful_record_migrates_without_rewriting_bundle(self):
        previous = [('api', '0017_clinical_decision_shown_choice')]
        current = [('api', '0020_handover_transaction_effects_recovery')]
        executor = MigrationExecutor(connection)
        executor.migrate(previous)
        historical = executor.loader.project_state(previous).apps.get_model('api', 'HandoverBundleRecord')
        original = {'resourceType': 'Bundle', 'type': 'transaction', 'entry': []}
        historical.objects.create(
            bundle_id='bundle-c04-historical', patient_id='pat-c04-historical', unit_id='icu-a',
            request_id='c04-historical', bundle_json=original,
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        executor = MigrationExecutor(connection)
        executor.migrate(current)
        migrated = executor.loader.project_state(current).apps.get_model('api', 'HandoverBundleRecord')
        record = migrated.objects.get(request_id='c04-historical')
        self.assertEqual(record.status, 'succeeded')
        self.assertEqual(record.bundle_json, original)
        self.assertEqual(record.payload_hash, '')
        self.assertFalse(record.effects_pending)
        self.assertEqual(record.accepted_actor_sub, '')
