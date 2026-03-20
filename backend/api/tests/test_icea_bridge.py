import datetime
import json
import os
import types
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from backend.api.clinical_storage import ENCRYPTED_BUNDLE_MARKER

from backend.api.icea_bridge_service import (
    STORED_BUNDLE_UNAVAILABLE_ERROR,
    _apply_remote_payload,
    _build_icea_plus_score_row,
    _mark_failed,
    _normalize_remote_payload,
    _persist_bridge_request_update,
    attempt_icea_bridge_delivery,
    enqueue_icea_bridge_request_for_bundle_record,
    load_icea_bridge_settings,
    refresh_icea_bridge_request,
    serialize_bridge_request,
)
from backend.api.icea_payload_mapper import build_icea_bridge_payload, compute_payload_hash
from backend.api.models import HandoverBundleRecord, IceaBridgeRequest, IceaPipelineSnapshot
from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response, build_icea_bundle


OBS_CODE_SYSTEM = 'urn:handover-pro:observation-codes'
SBAR_SYSTEM = 'urn:handover-pro:sbar'
BEDSIDE_SYSTEM = 'urn:handover-pro:bedside-checklist'
BOOL_SYSTEM = 'urn:handover-pro:boolean'
NOC_SYSTEM = 'urn:handover:terminology:NOC'
LOINC_SYSTEM = 'http://loinc.org'
HANDOVER_CONTEXT_SYSTEM = 'urn:handover-pro:context'
HANDOVER_CONTEXT_COMPONENT_SYSTEM = 'urn:handover-pro:component'
MODEL_ID = '11111111-1111-4111-8111-111111111111'
FHIR_FIXTURE_DIR = Path(__file__).resolve().parents[3] / 'tests' / 'fixtures' / 'fhir'


def load_fhir_fixture(name: str) -> dict:
    with (FHIR_FIXTURE_DIR / name).open('r', encoding='utf-8') as handle:
        return json.load(handle)


def build_unreadable_encrypted_bundle() -> dict:
    return {
        '_storage': ENCRYPTED_BUNDLE_MARKER,
        'v': 1,
        'alg': 'AES-256-GCM',
        'nonce': 'AA==',
        'ciphertext': 'AA==',
    }


def build_bridge_bundle(*, complete: bool = True) -> dict:
    bundle = build_icea_bundle(bundle_id='bundle-bridge-001', patient_id='pat-bridge-001', unit_id='icu-a')
    patient = bundle['entry'][0]['resource']
    patient['gender'] = 'female'
    patient['birthDate'] = '1988-05-10'
    composition = bundle['entry'][2]['resource']
    composition['date'] = '2026-03-08T07:10:00Z'
    composition['author'] = [{'reference': 'Practitioner/nurse-1'}]
    composition['attester'] = [
        {'party': {'reference': 'Practitioner/nurse-1', 'identifier': {'value': 'nurse-1'}}}
    ]
    bundle['signature'][0]['who'] = {'identifier': {'value': 'nurse-1'}, 'reference': 'Practitioner/nurse-1'}
    bundle['entry'].append(
        {
            'fullUrl': 'urn:uuid:prac-nurse-1',
            'request': {'method': 'POST', 'url': 'Practitioner'},
            'resource': {'resourceType': 'Practitioner', 'id': 'nurse-1'},
        }
    )
    if not complete:
        return bundle

    bundle['entry'].extend(
        [
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': OBS_CODE_SYSTEM, 'code': 'administrative'}]},
                    'valueString': 'Unit: ICU-A\nCensus: 14\nShift: 2026-03-08T07:00:00Z → 2026-03-08T15:00:00Z\nShift type: Mañana\nIncoming staff: Ana, Bea\nOutgoing staff: Luis\nIncidents: Fallo bomba',
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': OBS_CODE_SYSTEM, 'code': 'handover-notes'}]},
                    'valueString': 'Paciente estable con riesgo de caídas y vigilancia respiratoria.',
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': SBAR_SYSTEM, 'code': 'sbar'}]},
                    'component': [
                        {'code': {'coding': [{'system': SBAR_SYSTEM, 'code': 'situation'}]}, 'valueString': 'Situación'},
                        {'code': {'coding': [{'system': SBAR_SYSTEM, 'code': 'assessment'}]}, 'valueString': 'Valoración'},
                    ],
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': BEDSIDE_SYSTEM, 'code': 'bedside-checklist'}]},
                    'component': [
                        {
                            'code': {'coding': [{'system': BEDSIDE_SYSTEM, 'code': 'patientIdentityConfirmed'}]},
                            'valueCodeableConcept': {'coding': [{'system': BOOL_SYSTEM, 'code': 'yes'}]},
                        },
                        {
                            'code': {'coding': [{'system': BEDSIDE_SYSTEM, 'code': 'medicationPlanReviewed'}]},
                            'valueCodeableConcept': {'coding': [{'system': BOOL_SYSTEM, 'code': 'no'}]},
                        },
                    ],
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': HANDOVER_CONTEXT_SYSTEM, 'code': 'clinical-context'}]},
                    'component': [
                        {
                            'code': {'coding': [{'system': HANDOVER_CONTEXT_COMPONENT_SYSTEM, 'code': 'unit-profile'}]},
                            'valueString': 'Critical care (critical-care)',
                        },
                        {
                            'code': {'coding': [{'system': HANDOVER_CONTEXT_COMPONENT_SYSTEM, 'code': 'specialty-overlay'}]},
                            'valueString': 'Neurologia (neuro)',
                        },
                        {
                            'code': {'coding': [{'system': HANDOVER_CONTEXT_COMPONENT_SYSTEM, 'code': 'priority-signal'}]},
                            'valueString': 'Ventilacion y microvigilancia respiratoria',
                        },
                        {
                            'code': {'coding': [{'system': HANDOVER_CONTEXT_COMPONENT_SYSTEM, 'code': 'pending-critical-task-count'}]},
                            'valueInteger': 2,
                        },
                    ],
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': LOINC_SYSTEM, 'code': '59408-5'}]},
                    'valueQuantity': {'value': 88},
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'code': {'coding': [{'system': LOINC_SYSTEM, 'code': '38876-5'}]},
                    'valueInteger': 12,
                }
            },
            {
                'resource': {
                    'resourceType': 'Observation',
                    'status': 'final',
                    'category': [{'coding': [{'system': 'http://terminology.hl7.org/CodeSystem/observation-category', 'code': 'outcome'}]}],
                    'code': {'coding': [{'system': NOC_SYSTEM, 'code': '0907', 'display': 'Knowledge: medication'}]},
                    'component': [
                        {'code': {'coding': [{'code': 'baseline'}]}, 'valueInteger': 2},
                        {'code': {'coding': [{'code': 'target'}]}, 'valueInteger': 4},
                        {'code': {'coding': [{'code': 'current'}]}, 'valueInteger': 3},
                    ],
                }
            },
            {
                'resource': {
                    'resourceType': 'Condition',
                    'category': [{'coding': [{'display': 'Risk'}]}],
                    'code': {'text': 'Fall risk', 'coding': [{'system': 'http://snomed.info/sct', 'code': '248244005', 'display': 'Risk for falls'}]},
                }
            },
            {
                'resource': {
                    'resourceType': 'Condition',
                    'code': {'coding': [{'system': 'urn:handover:terminology:NANDA-I', 'code': '00155', 'display': 'Acute pain'}]},
                }
            },
            {
                'resource': {
                    'resourceType': 'MedicationStatement',
                    'status': 'active',
                    'subject': {'reference': 'Patient/pat-bridge-001'},
                    'medicationCodeableConcept': {'text': 'Furosemida'},
                    'dateAsserted': '2026-03-08T07:00:00Z',
                }
            },
            {
                'resource': {
                    'resourceType': 'Procedure',
                    'status': 'completed',
                    'subject': {'reference': 'Patient/pat-bridge-001'},
                    'code': {'text': 'Curación'},
                }
            },
        ]
    )
    return bundle



def build_bridge_bundle_with_extra_medication() -> dict:
    bundle = build_bridge_bundle()
    bundle['entry'].append(
        {
            'resource': {
                'resourceType': 'MedicationStatement',
                'status': 'active',
                'subject': {'reference': 'Patient/pat-bridge-001'},
                'medicationCodeableConcept': {'text': 'Paracetamol'},
                'dateAsserted': '2026-03-08T08:00:00Z',
            }
        }
    )
    return bundle


class IceaBridgeMapperTests(TestCase):
    def test_mapper_builds_payload_with_quality_and_missingness_signals(self):
        payload = build_icea_bridge_payload(
            build_bridge_bundle(),
            request_id='req-bridge-001',
            scoring_mode='immediate_provisional',
            unit_id='icu-a',
        )

        self.assertEqual(payload['identity']['handoverId'], 'bundle-bridge-001')
        self.assertEqual(payload['context']['grain'], 'shift')
        self.assertEqual(payload['context']['windowStart'], '2026-03-08T07:00:00Z')
        self.assertEqual(payload['context']['windowEnd'], '2026-03-08T15:00:00Z')
        self.assertEqual(payload['context']['shift'], 'Mañana')
        self.assertEqual(payload['context']['handoverLoad']['census'], 14)
        self.assertEqual(payload['nursingExposure']['documentedMedicationCount'], 1)
        self.assertEqual(payload['nursingExposure']['documentedProcedureCount'], 1)
        self.assertEqual(payload['nursingExposure']['documentedOutcomeCount'], 1)
        self.assertEqual(payload['caseMix']['ageYears'], 37)
        self.assertEqual(payload['caseMix']['diagnoses'][0]['type'], 'medical')
        self.assertLess(payload['uncertaintySignals']['missingnessRate'], 0.5)
        self.assertGreater(payload['qualitySignals']['structuredCompletenessRate'], 0.7)
        self.assertTrue(payload['nursingExposure']['severityWeight'] is not None)
        self.assertEqual(payload['contextualSignal']['contract_version'], 'handover-icea-context-v1')
        self.assertEqual(payload['contextualSignal']['profile_id'], 'critical-care')
        self.assertEqual(payload['contextualSignal']['overlay_ids'], ['neuro'])
        self.assertEqual(payload['contextualSignal']['case_mix_envelope']['observed_fields']['pending_critical_task_count']['value'], 2.0)
        self.assertGreater(payload['contextualSignal']['case_mix_envelope']['baseline_complexity'], 0.0)
        self.assertIn(
            'nurse_to_patient_ratio',
            payload['contextualSignal']['case_mix_envelope']['pending_hospital_source_fields'],
        )

    def test_mapper_degrades_without_inventing_missing_fields(self):
        payload = build_icea_bridge_payload(
            build_bridge_bundle(complete=False),
            request_id='req-bridge-002',
            scoring_mode='immediate_provisional',
            unit_id='icu-a',
        )

        self.assertEqual(payload['nursingExposure']['documentedMedicationCount'], 0)
        self.assertEqual(payload['nursingExposure']['documentedProcedureCount'], 0)
        self.assertIsNone(payload['nursingExposure']['severityWeight'])
        self.assertGreaterEqual(payload['uncertaintySignals']['missingnessRate'], 0.5)
        warning_codes = {item['code'] for item in payload['uncertaintySignals']['warnings']}
        self.assertIn('insufficient_evidence', warning_codes)
        self.assertIn('missing_shift_window', warning_codes)
        self.assertIsNone(payload['contextualSignal']['profile_id'])
        self.assertEqual(payload['contextualSignal']['overlay_ids'], [])

    def test_mapper_degrades_when_shift_window_is_invalid(self):
        bundle = build_bridge_bundle()
        admin_observation = next(
            entry['resource']
            for entry in bundle['entry']
            if entry.get('resource', {}).get('resourceType') == 'Observation'
            and entry['resource'].get('code', {}).get('coding', [{}])[0].get('code') == 'administrative'
        )
        admin_observation['valueString'] = admin_observation['valueString'].replace(
            'Shift: 2026-03-08T07:00:00Z → 2026-03-08T15:00:00Z',
            'Shift: 2026-03-08T07:00:00Z -> not-a-datetime',
        )

        payload = build_icea_bridge_payload(
            bundle,
            request_id='req-bridge-invalid-shift',
            scoring_mode='immediate_provisional',
            unit_id='icu-a',
        )

        self.assertEqual(payload['context']['grain'], 'episode')
        self.assertIsNone(payload['context']['windowStart'])
        self.assertIsNone(payload['context']['windowEnd'])
        warning_codes = {item['code'] for item in payload['uncertaintySignals']['warnings']}
        self.assertIn('invalid_shift_window', warning_codes)
        self.assertIn('missing_shift_window', warning_codes)

    def test_contextual_contract_is_serialized_for_real_bridge_projection(self):
        payload = build_icea_bridge_payload(
            build_bridge_bundle(),
            request_id='req-bridge-ctx-001',
            scoring_mode='immediate_provisional',
            unit_id='icu-a',
        )
        bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-ctx-001:immediate_provisional',
            request_id='req-bridge-ctx-001',
            bundle_id='bundle-bridge-001',
            patient_id='pat-bridge-001',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-ctx-001:immediate_provisional:ctx',
            payload_hash='ctx' * 16,
            payload_json=payload,
            status=IceaBridgeRequest.STATUS_QUEUED,
        )

        row = _build_icea_plus_score_row(payload, bridge_request=bridge_request)

        self.assertTrue(row['lineage']['contextual_signal_present'])
        self.assertEqual(row['lineage']['contextual_contract_version'], 'handover-icea-context-v1')
        self.assertEqual(row['lineage']['contextual_signal']['profile_id'], 'critical-care')
        self.assertEqual(row['lineage']['contextual_signal']['case_mix_envelope']['therapeutic_load'], payload['contextualSignal']['case_mix_envelope']['therapeutic_load'])

    def test_bridge_projection_remains_backward_compatible_without_contextual_signal(self):
        payload = {
            'contractVersion': 'handover-icea-bridge-v1',
            'identity': {'bundleId': 'bundle-legacy', 'requestId': 'req-legacy', 'patientId': 'pat-legacy'},
            'context': {'grain': 'episode', 'unitId': 'icu-a'},
            'caseMix': {},
            'nursingExposure': {},
            'qualitySignals': {},
            'uncertaintySignals': {},
            'provenance': {'lineage': {'requestId': 'req-legacy'}},
        }
        bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-legacy:immediate_provisional',
            request_id='req-legacy',
            bundle_id='bundle-legacy',
            patient_id='pat-legacy',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-legacy:immediate_provisional:legacy',
            payload_hash='legacy' * 10 + 'abcd',
            payload_json=payload,
            status=IceaBridgeRequest.STATUS_QUEUED,
        )

        row = _build_icea_plus_score_row(payload, bridge_request=bridge_request)

        self.assertFalse(row['lineage']['contextual_signal_present'])
        self.assertIsNone(row['lineage']['contextual_contract_version'])
        self.assertIsNone(row['lineage']['contextual_signal'])

    def test_contextual_contract_regression_fixtures_cover_uci_ward_ed_and_oncology(self):
        scenarios = [
            ('uci-adulto-contextual-bundle.json', 'critical-care', [], 1.0),
            ('hospitalizacion-general-medicina-interna-contextual-bundle.json', 'general-inpatient', [], 1.0),
            ('urgencias-contextual-bundle.json', 'emergency', [], 1.0),
            ('oncologia-eoprop-ia-contextual-bundle.json', 'ambulatory', ['onc'], 1.0),
        ]

        for fixture_name, expected_profile_id, expected_overlay_ids, expected_pending_count in scenarios:
            with self.subTest(fixture=fixture_name):
                payload = build_icea_bridge_payload(
                    load_fhir_fixture(fixture_name),
                    request_id=f'req-{fixture_name}',
                    scoring_mode='immediate_provisional',
                    unit_id='fixture-unit',
                )

                self.assertEqual(payload['contextualSignal']['contract_version'], 'handover-icea-context-v1')
                self.assertEqual(payload['contextualSignal']['profile_id'], expected_profile_id)
                self.assertEqual(payload['contextualSignal']['overlay_ids'], expected_overlay_ids)
                self.assertEqual(
                    payload['contextualSignal']['case_mix_envelope']['observed_fields']['pending_critical_task_count']['value'],
                    expected_pending_count,
                )
                self.assertIn(
                    'nurse_to_patient_ratio',
                    payload['contextualSignal']['case_mix_envelope']['pending_hospital_source_fields'],
                )
                self.assertIn(
                    'Deterministic stratification only',
                    payload['contextualSignal']['case_mix_envelope']['explainability_summary'],
                )


class IceaBridgeServiceTests(TestCase):
    def setUp(self):
        self.record = HandoverBundleRecord.objects.create(
            bundle_id='bundle-bridge-001',
            patient_id='pat-bridge-001',
            unit_id='icu-a',
            request_id='req-bridge-001',
            bundle_json=build_bridge_bundle(),
            expires_at=HandoverBundleRecord.default_expiry(),
        )

    @patch.dict(
        os.environ,
        {
            'ICEA_BRIDGE_SCORE_PATH': '',
            'ICEA_BRIDGE_STATUS_PATH': '',
        },
        clear=False,
    )
    def test_bridge_settings_default_to_real_upstream_score_path_and_optional_status_refresh(self):
        settings = load_icea_bridge_settings()

        self.assertTrue(settings.immediate_enabled)
        self.assertFalse(settings.enriched_enabled)
        self.assertEqual(settings.score_path, '/api/v1/icea-plus/score/')
        self.assertEqual(settings.status_path, '')
        self.assertFalse(settings.has_remote_status)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': '',
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_bridge_fails_fast_when_model_id_is_missing(self, mock_request):
        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(bridge_request.last_error, 'missing_icea_bridge_model_id')
        self.assertEqual(bridge_request.attempts, 0)
        self.assertIsNone(bridge_request.last_http_status)
        mock_request.assert_not_called()

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': 'not-a-uuid',
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_bridge_fails_fast_when_model_id_is_invalid(self, mock_request):
        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(bridge_request.last_error, 'invalid_icea_bridge_model_id')
        self.assertEqual(bridge_request.attempts, 0)
        self.assertIsNone(bridge_request.last_http_status)
        mock_request.assert_not_called()

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_delivery_sends_expected_payload_and_marks_request_accepted(self, mock_request):
        remote = Mock()
        remote.status_code = 202
        remote.text = '{"status":"accepted","requestId":"req-bridge-001"}'
        remote.headers = {'Content-Type': 'application/json'}
        remote.json.return_value = {'status': 'accepted', 'requestId': 'req-bridge-001'}
        mock_request.return_value = remote

        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_ACCEPTED)
        self.assertEqual(bridge_request.last_http_status, 202)
        self.assertTrue(bridge_request.payload_hash)
        self.assertTrue(bridge_request.idempotency_key.startswith('req-bridge-001:immediate_provisional:'))
        self.assertEqual(mock_request.call_args.kwargs['headers']['Idempotency-Key'], bridge_request.idempotency_key)
        self.assertTrue(mock_request.call_args.args[1].endswith('/api/v1/icea-plus/score/'))
        self.assertEqual(mock_request.call_args.kwargs['json']['model_id'], MODEL_ID)
        self.assertFalse(mock_request.call_args.kwargs['json']['from_db'])
        self.assertEqual(mock_request.call_args.kwargs['json']['grain'], 'window')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['unit_code'], 'icu-a')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['unit_id'], 'icu-a')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['start_dt'], '2026-03-08T07:00:00Z')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['end_dt'], '2026-03-08T15:00:00Z')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['patient_key'], 'pat-bridge-001')
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['lineage']['bridge_request_id'], bridge_request.bridge_request_id)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ENABLE_ICEA_ENRICHED_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_delivery_parses_real_icea_plus_score_response(self, mock_request):
        remote = Mock()
        remote.status_code = 200
        remote.text = '{"formula_version":"icea_plus_v1","summary":{"rows_requested":1,"rows_scored":1,"status_counts":{"complete":0,"provisional":1,"insufficient_evidence":0}},"results":[{"row_id":"window:bundle-bridge-001","status":"provisional","provisional":true,"score":82.0,"raw_score":0.82,"confidence":{"value":0.81,"label":"high"},"flags":{"insufficient_evidence":false},"components":{"quality":{"normalized":0.3}}}]}'
        remote.headers = {'Content-Type': 'application/json'}
        remote.json.return_value = {
            'formula_version': 'icea_plus_v1',
            'summary': {
                'rows_requested': 1,
                'rows_scored': 1,
                'status_counts': {'complete': 0, 'provisional': 1, 'insufficient_evidence': 0},
            },
            'results': [
                {
                    'row_id': 'window:bundle-bridge-001',
                    'status': 'provisional',
                    'provisional': True,
                    'score': 82.0,
                    'raw_score': 0.82,
                    'confidence': {'value': 0.81, 'label': 'high'},
                    'flags': {'insufficient_evidence': False},
                    'components': {'quality': {'normalized': 0.3}},
                }
            ],
        }
        mock_request.return_value = remote

        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_ENRICHED,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_SCORED)
        self.assertTrue(bridge_request.provisional)
        self.assertEqual(bridge_request.formula_version, 'icea_plus_v1')
        self.assertEqual(bridge_request.score_summary_json['score'], 82.0)
        self.assertEqual(bridge_request.score_summary_json['rowStatus'], 'provisional')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request', side_effect=httpx.ConnectTimeout('icea down'))
    def test_bridge_failure_is_persisted_for_retry(self, _mock_request):
        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_FAILED)
        self.assertGreaterEqual(bridge_request.attempts, 1)
        self.assertEqual(bridge_request.last_error, 'ConnectTimeout')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_enqueue_same_payload_does_not_schedule_duplicate_delivery(self, mock_schedule):
        first = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        second = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )

        self.assertEqual(first.id, second.id)
        mock_schedule.assert_called_once_with(first.id)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_stale_worker_uses_latest_payload_after_queued_refresh(self, mock_request, mock_schedule):
        remote = Mock()
        remote.status_code = 202
        remote.text = '{"status":"accepted","requestId":"req-bridge-001"}'
        remote.headers = {'Content-Type': 'application/json'}
        remote.json.return_value = {'status': 'accepted', 'requestId': 'req-bridge-001'}
        mock_request.return_value = remote

        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        stale_worker_request = IceaBridgeRequest.objects.get(id=bridge_request.id)
        self.record.bundle_json = build_bridge_bundle_with_extra_medication()
        self.record.save(update_fields=['bundle_json'])

        refreshed = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        refreshed.refresh_from_db()

        result = attempt_icea_bridge_delivery(stale_worker_request)
        refreshed.refresh_from_db()

        self.assertEqual(result.status, IceaBridgeRequest.STATUS_ACCEPTED)
        self.assertEqual(refreshed.status, IceaBridgeRequest.STATUS_ACCEPTED)
        self.assertEqual(mock_schedule.call_count, 1)
        self.assertEqual(mock_request.call_args.kwargs['headers']['Idempotency-Key'], refreshed.idempotency_key)
        self.assertNotEqual(mock_request.call_args.kwargs['headers']['Idempotency-Key'], stale_worker_request.idempotency_key)
        self.assertEqual(mock_request.call_args.kwargs['json']['rows'][0]['documented_medication_count'], 2.0)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_in_flight_stale_response_does_not_overwrite_refreshed_payload(self, mock_request, mock_schedule):
        initial = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        stale_worker_request = IceaBridgeRequest.objects.get(id=initial.id)
        refreshed_bundle = build_bridge_bundle_with_extra_medication()

        def remote_side_effect(*_args, **_kwargs):
            self.record.bundle_json = refreshed_bundle
            self.record.save(update_fields=['bundle_json'])
            enqueue_icea_bridge_request_for_bundle_record(
                record=self.record,
                scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            )
            remote_response = Mock()
            remote_response.status_code = 202
            remote_response.text = '{"status":"accepted","jobId":"job-old-run"}'
            remote_response.headers = {'Content-Type': 'application/json'}
            remote_response.json.return_value = {'status': 'accepted', 'jobId': 'job-old-run'}
            return remote_response

        mock_request.side_effect = remote_side_effect

        result = attempt_icea_bridge_delivery(stale_worker_request)
        current = IceaBridgeRequest.objects.get(id=initial.id)
        self.assertEqual(result.detail, 'stale_delivery_ignored')
        self.assertEqual(current.status, IceaBridgeRequest.STATUS_QUEUED)
        self.assertNotEqual(current.payload_hash, stale_worker_request.payload_hash)
        self.assertIsNone(current.remote_refs_json)
        self.assertIsNone(current.received_at)
        self.assertEqual(current.attempts, 0)
        self.assertEqual(mock_schedule.call_count, 2)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_atomic_remote_apply_ignores_stale_payload_changed_during_final_persistence(self, mock_schedule):
        initial = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        stale_worker_request = IceaBridgeRequest.objects.get(id=initial.id)
        refreshed_bundle = build_bridge_bundle_with_extra_medication()

        def normalize_side_effect(*args, **kwargs):
            self.record.bundle_json = refreshed_bundle
            self.record.save(update_fields=['bundle_json'])
            enqueue_icea_bridge_request_for_bundle_record(
                record=self.record,
                scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            )
            return _normalize_remote_payload(*args, **kwargs)

        with patch('backend.api.icea_bridge_service._normalize_remote_payload', side_effect=normalize_side_effect):
            result = _apply_remote_payload(
                stale_worker_request,
                {'status': 'accepted', 'jobId': 'job-old-run'},
                202,
                expected_payload_hash=stale_worker_request.payload_hash,
                expected_idempotency_key=stale_worker_request.idempotency_key,
            )

        current = IceaBridgeRequest.objects.get(id=initial.id)
        self.assertEqual(result.detail, 'stale_delivery_ignored')
        self.assertEqual(current.status, IceaBridgeRequest.STATUS_QUEUED)
        self.assertNotEqual(current.payload_hash, stale_worker_request.payload_hash)
        self.assertIsNone(current.remote_refs_json)
        self.assertIsNone(current.received_at)
        self.assertEqual(current.attempts, 0)
        self.assertEqual(mock_schedule.call_count, 1)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
            'ICEA_BRIDGE_STATUS_PATH': '/api/v1/icea-plus/status/',
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_remote_refresh_ignores_stale_status_after_payload_refresh(self, mock_request, mock_schedule):
        initial = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        IceaBridgeRequest.objects.filter(id=initial.id).update(
            status=IceaBridgeRequest.STATUS_PENDING,
            remote_refs_json={'jobId': 'job-old-run'},
        )
        stale_refresh_request = IceaBridgeRequest.objects.get(id=initial.id)
        refreshed_bundle = build_bridge_bundle_with_extra_medication()

        def remote_side_effect(*_args, **_kwargs):
            self.record.bundle_json = refreshed_bundle
            self.record.save(update_fields=['bundle_json'])
            enqueue_icea_bridge_request_for_bundle_record(
                record=self.record,
                scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            )
            remote_response = Mock()
            remote_response.status_code = 200
            remote_response.text = '{"status":"accepted","jobId":"job-old-run"}'
            remote_response.headers = {'Content-Type': 'application/json'}
            remote_response.json.return_value = {'status': 'accepted', 'jobId': 'job-old-run'}
            return remote_response

        mock_request.side_effect = remote_side_effect

        result = refresh_icea_bridge_request(stale_refresh_request)

        current = IceaBridgeRequest.objects.get(id=initial.id)
        self.assertEqual(result.detail, 'stale_delivery_ignored')
        self.assertEqual(current.status, IceaBridgeRequest.STATUS_QUEUED)
        self.assertNotEqual(current.payload_hash, stale_refresh_request.payload_hash)
        self.assertIsNone(current.remote_refs_json)
        self.assertIsNone(current.last_http_status)
        self.assertIsNone(current.received_at)
        self.assertEqual(mock_schedule.call_count, 2)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_mark_failed_does_not_overwrite_refreshed_payload_during_final_persistence(self, mock_schedule):
        initial = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        stale_worker_request = IceaBridgeRequest.objects.get(id=initial.id)
        refreshed_bundle = build_bridge_bundle_with_extra_medication()

        def persist_side_effect(*args, **kwargs):
            self.record.bundle_json = refreshed_bundle
            self.record.save(update_fields=['bundle_json'])
            enqueue_icea_bridge_request_for_bundle_record(
                record=self.record,
                scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            )
            return _persist_bridge_request_update(*args, **kwargs)

        with patch('backend.api.icea_bridge_service._persist_bridge_request_update', side_effect=persist_side_effect):
            result = _mark_failed(
                stale_worker_request,
                detail='transport_error',
                http_status=503,
                expected_payload_hash=stale_worker_request.payload_hash,
                expected_idempotency_key=stale_worker_request.idempotency_key,
            )

        current = IceaBridgeRequest.objects.get(id=initial.id)
        self.assertEqual(result.detail, 'stale_delivery_ignored')
        self.assertEqual(current.status, IceaBridgeRequest.STATUS_QUEUED)
        self.assertNotEqual(current.payload_hash, stale_worker_request.payload_hash)
        self.assertEqual(current.last_error, '')
        self.assertIsNone(current.last_http_status)
        self.assertIsNone(current.received_at)
        self.assertEqual(mock_schedule.call_count, 1)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_payload_refresh_resets_remote_traceability_for_new_run(self, mock_schedule):
        original_payload = build_icea_bridge_payload(
            build_bridge_bundle(),
            request_id='req-bridge-001',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            unit_id='icu-a',
        )
        bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-001:immediate_provisional',
            request_id='req-bridge-001',
            bundle_id='bundle-bridge-001',
            patient_id='pat-bridge-001',
            unit_id='icu-a',
            episode_id='enc-bridge-001',
            shift='Mañana',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key=(
                f"req-bridge-001:{IceaBridgeRequest.SCORING_MODE_IMMEDIATE}:{compute_payload_hash(original_payload)[:16]}"
            ),
            payload_hash=compute_payload_hash(original_payload),
            payload_json=original_payload,
            status=IceaBridgeRequest.STATUS_SCORED,
            provisional=False,
            insufficient_evidence=False,
            contract_version='handover-icea-bridge-v1',
            formula_version='icea_plus_v1',
            score_summary_json={'score': 82.0},
            warnings_json=[{'code': 'remote_warning', 'message': 'Old remote warning'}],
            remote_refs_json={'jobId': 'job-old-run', 'resultId': 'result-old-run'},
            attempts=3,
            last_error='old error',
            last_http_status=200,
            sent_at=timezone.now() - datetime.timedelta(minutes=5),
            received_at=timezone.now() - datetime.timedelta(minutes=4),
        )
        self.record.bundle_json = build_bridge_bundle_with_extra_medication()
        self.record.save(update_fields=['bundle_json'])

        refreshed = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        refreshed.refresh_from_db()
        latest_payload = build_icea_bridge_payload(
            self.record.bundle_json,
            request_id='req-bridge-001',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            unit_id='icu-a',
        )

        self.assertEqual(refreshed.id, bridge_request.id)
        self.assertEqual(refreshed.status, IceaBridgeRequest.STATUS_QUEUED)
        self.assertNotEqual(refreshed.payload_hash, compute_payload_hash(original_payload))
        self.assertEqual(refreshed.formula_version, '')
        self.assertIsNone(refreshed.score_summary_json)
        self.assertIsNone(refreshed.remote_refs_json)
        self.assertEqual(refreshed.warnings_json, latest_payload['uncertaintySignals']['warnings'])
        self.assertEqual(refreshed.attempts, 0)
        self.assertEqual(refreshed.last_error, '')
        self.assertIsNone(refreshed.last_http_status)
        self.assertIsNone(refreshed.sent_at)
        self.assertIsNone(refreshed.received_at)
        mock_schedule.assert_called_once_with(bridge_request.id)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.icea_bridge_service.httpx.request')
    def test_enqueue_marks_failed_when_bundle_cannot_be_decrypted(self, mock_request):
        self.record.bundle_json = build_unreadable_encrypted_bundle()
        self.record.encryption_metadata = {'key_source': 'secret_key_derived'}
        self.record.save(update_fields=['bundle_json', 'encryption_metadata'])

        bridge_request = enqueue_icea_bridge_request_for_bundle_record(
            record=self.record,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        bridge_request.refresh_from_db()

        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(bridge_request.last_error, STORED_BUNDLE_UNAVAILABLE_ERROR)
        self.assertEqual(bridge_request.bundle_id, 'bundle-bridge-001')
        mock_request.assert_not_called()


    def test_normalize_remote_payload_accepts_alias_fields_and_collects_remote_refs(self):
        bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-alias:immediate_provisional',
            request_id='req-bridge-alias',
            bundle_id='bundle-bridge-alias',
            patient_id='pat-bridge-alias',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-alias:immediate_provisional:alias',
            payload_hash='alias' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_SENT,
        )

        normalized = _normalize_remote_payload(
            {
                'state': 'completed',
                'formulaVersion': 'icea_plus_v2',
                'issues': ['Remote latency'],
                'model': {'id': 'model-bridge-1', 'version': '2026.03'},
                'jobId': 'job-bridge-1',
            },
            bridge_request=bridge_request,
            http_status=200,
            stale_after_seconds=60,
        )

        self.assertEqual(normalized['status'], IceaBridgeRequest.STATUS_SCORED)
        self.assertEqual(normalized['formulaVersion'], 'icea_plus_v2')
        self.assertEqual(normalized['warnings'][0]['code'], 'remote_warning')
        self.assertEqual(normalized['remoteRefs']['jobId'], 'job-bridge-1')
        self.assertEqual(normalized['remoteRefs']['modelId'], 'model-bridge-1')
        self.assertEqual(normalized['remoteRefs']['modelVersion'], '2026.03')

    def test_normalize_remote_payload_marks_stale_without_name_error(self):
        bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-stale:immediate_provisional',
            request_id='req-bridge-stale',
            bundle_id='bundle-bridge-stale',
            patient_id='pat-bridge-stale',
            unit_id='icu-a',
            episode_id='enc-bridge-stale',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-stale:immediate_provisional:stale',
            payload_hash='stale' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_SENT,
        )
        IceaBridgeRequest.objects.filter(id=bridge_request.id).update(updated_at=timezone.now() - datetime.timedelta(minutes=10))
        bridge_request.refresh_from_db()

        normalized = _normalize_remote_payload(
            {},
            bridge_request=bridge_request,
            http_status=200,
            stale_after_seconds=60,
        )

        self.assertEqual(normalized['status'], IceaBridgeRequest.STATUS_STALE)


class IceaBridgeApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.status_detail_url = reverse('icea-bridge-status-detail', kwargs={'handover_id': 'bundle-bridge-001'})
        self.status_query_url = reverse('icea-bridge-status-query')
        self.summary_url = reverse('icea-bridge-summary', kwargs={'handover_id': 'bundle-bridge-001'})
        self.retry_url = reverse('icea-bridge-retry', kwargs={'bridge_id': 1})
        self.bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-bridge-001:immediate_provisional',
            request_id='req-bridge-001',
            bundle_id='bundle-bridge-001',
            patient_id='pat-bridge-001',
            unit_id='icu-a',
            episode_id='enc-bridge-001',
            shift='Mañana',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-bridge-001:immediate_provisional:abcd',
            payload_hash='abcd' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_PENDING,
            warnings_json=[{'code': 'insufficient_evidence', 'message': 'Not enough data'}],
            attempts=2,
            remote_refs_json={'jobId': 'job-bridge-001'},
        )
        self.retry_url = reverse('icea-bridge-retry', kwargs={'bridge_id': self.bridge_request.id})
        HandoverBundleRecord.objects.create(
            bundle_id='bundle-bridge-001',
            patient_id='pat-bridge-001',
            unit_id='icu-a',
            request_id='req-bridge-001',
            bundle_json=build_bridge_bundle(),
            expires_at=HandoverBundleRecord.default_expiry(),
        )

    def _auth(self, *, roles, sub='auth0|bridge-user'):
        claims = {'sub': sub, 'roles': roles, 'permissions': ['handover:write']}
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub=sub, username=sub)
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer bridge-token')

    def test_detail_view_allows_clinician_role(self):
        self._auth(roles=['nurse'])

        response = self.client.get(self.status_detail_url, {'refresh': 'false'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['bridgeRequest']['status'], 'pending')
        self.assertEqual(response.json()['bridgeRequest']['attempts'], 2)
        self.assertEqual(response.json()['bridgeRequest']['remoteRefs']['jobId'], 'job-bridge-001')
        self.assertTrue(response.json()['summary']['provisional'])

    @patch('backend.api.views_icea_bridge.refresh_icea_bridge_request')
    def test_detail_view_uses_local_status_metadata_without_remote_refresh_by_default(self, mock_refresh):
        self._auth(roles=['supervisor'])

        response = self.client.get(self.status_detail_url)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['remoteStatusSupported'])
        self.assertFalse(response.json()['remoteRefreshAttempted'])
        self.assertTrue(response.json()['localStatusIsAuthoritative'])
        mock_refresh.assert_not_called()

    def test_query_view_requires_supervisor_or_admin(self):
        self._auth(roles=['nurse'])

        response = self.client.get(self.status_query_url, {'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 403)

    def test_query_view_returns_results_for_supervisor(self):
        self._auth(roles=['supervisor'])

        response = self.client.get(self.status_query_url, {'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(response.json()['results'][0]['handoverId'], 'bundle-bridge-001')
        self.assertEqual(response.json()['results'][0]['attempts'], 2)
        self.assertEqual(response.json()['results'][0]['remoteRefs']['jobId'], 'job-bridge-001')

    def test_query_view_accepts_handover_alias_filter(self):
        self._auth(roles=['supervisor'])

        response = self.client.get(self.status_query_url, {'handoverId': 'bundle-bridge-001'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(response.json()['results'][0]['bundleId'], 'bundle-bridge-001')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
            'ICEA_BRIDGE_STATUS_PATH': '',
        },
        clear=False,
    )
    def test_detail_view_reports_missing_remote_status_path_when_refresh_requested(self):
        self._auth(roles=['supervisor'])

        response = self.client.get(self.status_detail_url, {'refresh': 'true'})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['remoteStatusSupported'])
        self.assertFalse(response.json()['remoteRefreshAttempted'])
        self.assertTrue(response.json()['localStatusIsAuthoritative'])
        self.assertEqual(response.json()['remoteError']['code'], 'icea_bridge_status_not_configured')
        self.assertEqual(response.json()['bridgeRequest']['status'], 'pending')

    def test_retry_returns_400_for_invalid_scoring_mode(self):
        self._auth(roles=['admin'])

        response = self.client.post(self.retry_url, data={'scoringMode': 'unsupported'}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'invalid_scoring_mode')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': '',
        },
        clear=False,
    )
    def test_retry_returns_explicit_configuration_error_when_model_id_is_missing(self):
        self._auth(roles=['admin'])

        response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'missing_icea_bridge_model_id')

    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_requires_admin_and_can_trigger_enriched_followup(self, mock_service_schedule, mock_view_schedule):
        self._auth(roles=['admin'])

        with patch.dict(
            os.environ,
            {'ENABLE_ICEA_BRIDGE': 'true', 'ENABLE_ICEA_ENRICHED_SCORING': 'true', 'ICEA_BRIDGE_MODEL_ID': MODEL_ID},
            clear=False,
        ):
            response = self.client.post(self.retry_url, data={'scoringMode': 'enriched_followup'}, format='json')

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()['bridgeRequest']['scoringMode'], 'enriched_followup')
        enriched = IceaBridgeRequest.objects.get(bridge_request_id='req-bridge-001:enriched_followup')
        mock_service_schedule.assert_called_once_with(enriched.id, force=True)
        mock_view_schedule.assert_not_called()

    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_same_mode_schedules_delivery_once_via_helper(self, mock_service_schedule, mock_view_schedule):
        self._auth(roles=['admin'])

        with patch.dict(
            os.environ,
            {
                'ENABLE_ICEA_BRIDGE': 'true',
                'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
                'ICEA_API_BASE_URL': 'https://icea.example',
                'ICEA_API_BEARER_TOKEN': 'svc-token',
                'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
            },
            clear=False,
        ):
            response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()['bridgeRequest']['scoringMode'], IceaBridgeRequest.SCORING_MODE_IMMEDIATE)
        mock_service_schedule.assert_called_once_with(self.bridge_request.id, force=True)
        mock_view_schedule.assert_not_called()

    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_same_mode_forces_delivery_when_payload_is_unchanged(self, mock_service_schedule, mock_view_schedule):
        self._auth(roles=['admin'])
        payload = build_icea_bridge_payload(
            build_bridge_bundle(),
            request_id='req-bridge-001',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            unit_id='icu-a',
        )
        payload_hash = compute_payload_hash(payload)
        self.bridge_request.payload_json = payload
        self.bridge_request.payload_hash = payload_hash
        self.bridge_request.idempotency_key = (
            f'req-bridge-001:{IceaBridgeRequest.SCORING_MODE_IMMEDIATE}:{payload_hash[:16]}'
        )
        self.bridge_request.save(update_fields=['payload_json', 'payload_hash', 'idempotency_key'])

        with patch.dict(
            os.environ,
            {
                'ENABLE_ICEA_BRIDGE': 'true',
                'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
                'ICEA_API_BASE_URL': 'https://icea.example',
                'ICEA_API_BEARER_TOKEN': 'svc-token',
                'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
            },
            clear=False,
        ):
            response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 202)
        mock_service_schedule.assert_called_once_with(self.bridge_request.id, force=True)
        mock_view_schedule.assert_not_called()

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_same_mode_returns_controlled_response_when_bundle_is_unavailable(
        self,
        mock_service_schedule,
        mock_view_schedule,
    ):
        self._auth(roles=['admin'])
        HandoverBundleRecord.objects.filter(request_id='req-bridge-001').update(
            bundle_json=build_unreadable_encrypted_bundle(),
            encryption_metadata={'key_source': 'secret_key_derived'},
        )

        response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], STORED_BUNDLE_UNAVAILABLE_ERROR)
        self.assertEqual(response.json()['detail'], 'Stored bundle is unavailable.')
        self.assertEqual(response.json()['bridgeRequest']['status'], IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(response.json()['bridgeRequest']['lastError'], STORED_BUNDLE_UNAVAILABLE_ERROR)
        mock_service_schedule.assert_not_called()
        mock_view_schedule.assert_not_called()

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ENABLE_ICEA_ENRICHED_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_returns_controlled_response_when_stored_bundle_is_unavailable(
        self,
        mock_service_schedule,
        mock_view_schedule,
    ):
        self._auth(roles=['admin'])
        HandoverBundleRecord.objects.filter(request_id='req-bridge-001').update(
            bundle_json=build_unreadable_encrypted_bundle(),
            encryption_metadata={'key_source': 'secret_key_derived'},
        )

        response = self.client.post(self.retry_url, data={'scoringMode': 'enriched_followup'}, format='json')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], STORED_BUNDLE_UNAVAILABLE_ERROR)
        self.assertEqual(response.json()['detail'], 'Stored bundle is unavailable.')
        self.assertEqual(response.json()['bridgeRequest']['status'], IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(response.json()['bridgeRequest']['lastError'], STORED_BUNDLE_UNAVAILABLE_ERROR)
        mock_service_schedule.assert_not_called()
        mock_view_schedule.assert_not_called()

    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_returns_503_when_bridge_is_disabled(self, mock_service_schedule, mock_view_schedule):
        self._auth(roles=['admin'])

        response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'icea_bridge_disabled')
        mock_service_schedule.assert_not_called()
        mock_view_schedule.assert_not_called()

    @patch('backend.api.views_icea_bridge.schedule_icea_bridge_delivery', create=True)
    @patch('backend.api.icea_bridge_service.schedule_icea_bridge_delivery')
    def test_retry_returns_404_when_local_bundle_is_not_found(self, mock_service_schedule, mock_view_schedule):
        self._auth(roles=['admin'])
        HandoverBundleRecord.objects.filter(request_id='req-bridge-001').delete()

        with patch.dict(
            os.environ,
            {
                'ENABLE_ICEA_BRIDGE': 'true',
                'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
                'ICEA_API_BASE_URL': 'https://icea.example',
                'ICEA_API_BEARER_TOKEN': 'svc-token',
                'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
            },
            clear=False,
        ):
            response = self.client.post(self.retry_url, format='json')

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'handover_bundle_not_found')
        mock_service_schedule.assert_not_called()
        mock_view_schedule.assert_not_called()

class IceaBridgeTransactionFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse('fhir-transaction')
        authenticate_api_client(self.client, sub='auth0|nurse-1')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.views._create_audit_event_for_transaction', autospec=True)
    @patch('backend.api.icea_bridge_service.httpx.request')
    @patch('backend.api.views._post_transaction_to_fhir')
    def test_successful_transaction_creates_bridge_request_after_local_persistence(self, mock_fhir_post, mock_bridge_request, _mock_audit):
        mock_fhir_post.return_value = build_fhir_response()
        remote = Mock()
        remote.status_code = 202
        remote.text = '{"status":"accepted"}'
        remote.headers = {'Content-Type': 'application/json'}
        remote.json.return_value = {'status': 'accepted'}
        mock_bridge_request.return_value = remote

        response = self.client.post(self.url, data=build_bridge_bundle(), format='json', HTTP_IDEMPOTENCY_KEY='req-bridge-001')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(HandoverBundleRecord.objects.filter(request_id='req-bridge-001').count(), 1)
        bridge_request = IceaBridgeRequest.objects.get(request_id='req-bridge-001')
        self.assertEqual(bridge_request.bundle_id, 'bundle-bridge-001')
        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_ACCEPTED)
        self.assertEqual(bridge_request.payload_json['contextualSignal']['contract_version'], 'handover-icea-context-v1')
        self.assertEqual(bridge_request.payload_json['contextualSignal']['profile_id'], 'critical-care')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_IMMEDIATE_SCORING': 'true',
            'ICEA_API_BASE_URL': 'https://icea.example',
            'ICEA_API_BEARER_TOKEN': 'svc-token',
            'ICEA_BRIDGE_MODEL_ID': MODEL_ID,
        },
        clear=False,
    )
    @patch('backend.api.views._create_audit_event_for_transaction', autospec=True)
    @patch('backend.api.icea_bridge_service.httpx.request', side_effect=httpx.ConnectTimeout('bridge timeout'))
    @patch('backend.api.views._post_transaction_to_fhir')
    def test_bridge_failure_does_not_break_clinical_transaction(self, mock_fhir_post, _mock_bridge_request, _mock_audit):
        mock_fhir_post.return_value = build_fhir_response()

        response = self.client.post(self.url, data=build_bridge_bundle(), format='json', HTTP_IDEMPOTENCY_KEY='req-bridge-002')

        self.assertEqual(response.status_code, 201)
        bridge_request = IceaBridgeRequest.objects.get(request_id='req-bridge-002')
        self.assertEqual(bridge_request.status, IceaBridgeRequest.STATUS_FAILED)
        self.assertEqual(bridge_request.last_error, 'ConnectTimeout')
        self.assertTrue(serialize_bridge_request(bridge_request)['lastError'])









class IceaPatientRiskApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse('icea-patient-risk')
        self.bridge_request = IceaBridgeRequest.objects.create(
            bridge_request_id='req-risk-001:immediate_provisional',
            request_id='req-risk-001',
            bundle_id='bundle-risk-001',
            patient_id='pat-risk-001',
            unit_id='icu-a',
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key='req-risk-001:immediate_provisional:abcd',
            payload_hash='abcd' * 16,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_SCORED,
            provisional=True,
            formula_version='icea_plus_v1',
            contract_version='handover-icea-bridge-v1',
            score_summary_json={
                'score': 82.0,
                'rowStatus': 'provisional',
                'confidence': {'value': 0.81, 'label': 'high'},
            },
            warnings_json=[{'code': 'remote_warning', 'message': 'Analytic support only'}],
        )

    def _auth(self, *, roles, sub='auth0|risk-user', unit_ids=None):
        claims = {'sub': sub, 'roles': roles, 'permissions': ['handover:write']}
        if unit_ids is not None:
            claims['unitIds'] = unit_ids
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub=sub, username=sub)
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer risk-token')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
            'ENABLE_ICEA_CAUSAL_SUMMARY': 'true',
            'ICEA_BRIDGE_STALE_AFTER_SECONDS': '1800',
        },
        clear=False,
    )
    def test_patient_risk_returns_provisional_summary_for_nurse(self):
        IceaPipelineSnapshot.objects.create(
            request_id='req-risk-001',
            bundle_id='bundle-risk-001',
            patient_id='pat-risk-001',
            unit_id='icu-a',
            visible_status='succeeded',
            last_stage='causal-report',
            stage_statuses={'causal-report': {'status': 'succeeded'}},
            causal_report_json={'report': {'available': True, 'summary': 'Resumen causal prudente', 'updatedAt': '2026-03-09T09:00:00Z'}},
        )
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001', 'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)
        summary = response.json()['results'][0]
        self.assertEqual(summary['clinicalStatus'], 'provisional')
        self.assertEqual(summary['score'], 82.0)
        self.assertEqual(summary['confidence']['label'], 'high')
        self.assertEqual(summary['provenance']['formulaVersion'], 'icea_plus_v1')
        self.assertEqual(summary['causalSummary']['summary'], 'Resumen causal prudente')
        self.assertIn('juicio clinico', summary['message'].lower())

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
            'ICEA_BRIDGE_STALE_AFTER_SECONDS': '60',
        },
        clear=False,
    )
    def test_patient_risk_marks_stale_data(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])
        IceaBridgeRequest.objects.filter(id=self.bridge_request.id).update(
            status=IceaBridgeRequest.STATUS_STALE,
            updated_at=timezone.now() - datetime.timedelta(minutes=10),
        )

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 200)
        summary = response.json()['results'][0]
        self.assertTrue(summary['stale'])
        self.assertIn('desactualizado', summary['message'].lower())

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_returns_empty_when_no_data_exists(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url, {'patientId': 'missing-patient'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 0)
        self.assertEqual(response.json()['results'], [])

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_surfaces_failed_remote_state(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])
        IceaBridgeRequest.objects.filter(id=self.bridge_request.id).update(
            status=IceaBridgeRequest.STATUS_FAILED,
            provisional=False,
            last_error='upstream timeout',
            score_summary_json=None,
        )

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 200)
        summary = response.json()['results'][0]
        self.assertEqual(summary['clinicalStatus'], 'failed')
        self.assertIsNone(summary['score'])
        self.assertIn('no se pudo', summary['message'].lower())

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'false',
        },
        clear=False,
    )
    def test_patient_risk_respects_feature_flag(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['code'], 'icea_patient_risk_disabled')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_rejects_nurse_unit_outside_scope(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001', 'unitId': 'icu-b'})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'icea_patient_risk_forbidden_unit')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_infers_single_unit_for_nurse_patient_query(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_rejects_nurse_global_query_without_filters(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a'])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'icea_patient_risk_filter_required')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_requires_unit_when_nurse_has_multiple_units(self):
        self._auth(roles=['nurse'], unit_ids=['icu-a', 'icu-b'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'icea_patient_risk_unit_required')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_requires_unit_when_nurse_has_no_resolvable_unit(self):
        self._auth(roles=['nurse'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'icea_patient_risk_unit_required')

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_allows_supervisor_global_query(self):
        self._auth(roles=['supervisor'])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_allows_admin_global_query(self):
        self._auth(roles=['admin'])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)

    @patch.dict(
        os.environ,
        {
            'ENABLE_ICEA_BRIDGE': 'true',
            'ENABLE_ICEA_PATIENT_RISK': 'true',
        },
        clear=False,
    )
    def test_patient_risk_requires_clinical_role(self):
        self._auth(roles=['viewer'])

        response = self.client.get(self.url, {'patientId': 'pat-risk-001'})

        self.assertEqual(response.status_code, 403)

