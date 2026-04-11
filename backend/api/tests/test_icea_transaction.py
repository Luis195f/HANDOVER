import uuid
from unittest.mock import patch

from django.db import IntegrityError
from django.test import RequestFactory, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from backend.api import icea_transaction
from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response, build_icea_bundle


class IceaTransactionHelperTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_extract_request_id_generates_uuid_when_headers_are_missing(self):
        request = self.factory.post('/api/fhir/transaction')

        request_id = icea_transaction._extract_request_id(request)

        self.assertTrue(request_id)
        self.assertEqual(str(uuid.UUID(request_id)), request_id)

    def test_extract_bundle_identifier_falls_back_to_resolved_request_id(self):
        request = self.factory.post('/api/fhir/transaction')
        request_id = icea_transaction._extract_request_id(request)

        bundle_id = icea_transaction._extract_bundle_identifier(
            {'resourceType': 'Bundle', 'type': 'transaction'},
            request,
            request_id=request_id,
        )

        self.assertEqual(bundle_id, request_id)

    @patch('backend.api.icea_transaction.logger')
    @patch('backend.api.icea_transaction.HandoverBundleRecord.objects.get_or_create', side_effect=IntegrityError)
    def test_persist_duplicate_does_not_raise_and_logs_request_id(self, _mock_get_or_create, mock_logger):
        request = self.factory.post(
            '/api/fhir/transaction',
            HTTP_IDEMPOTENCY_KEY='req-duplicate-001',
            HTTP_X_UNIT_ID='icu-a',
        )

        icea_transaction.persist_handover_bundle_record(
            bundle=build_icea_bundle(bundle_id='bundle-duplicate-001', patient_id='pat-duplicate-001', unit_id='icu-a'),
            request=request,
        )

        mock_logger.info.assert_called_once_with(
            'handover_bundle_duplicate_request',
            extra={'request_id': 'req-duplicate-001'},
        )


class IceaTransactionFlowRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse('fhir-transaction')
        authenticate_api_client(self.client, sub='auth0|nurse-order', unit_ids=['icu-a'])

    @patch('backend.api.views._create_audit_event_for_transaction', autospec=True)
    @patch('backend.api.views._post_transaction_to_fhir')
    def test_successful_transaction_preserves_icea_side_effect_order(self, mock_fhir_post, _mock_audit):
        order: list[str] = []
        mock_fhir_post.return_value = build_fhir_response()

        def record(name: str):
            def _inner(*args, **kwargs):
                order.append(name)
                return None

            return _inner

        with patch(
            'backend.api.views.enqueue_icea_outbound_event_for_transaction',
            side_effect=record('outbox'),
        ), patch(
            'backend.api.views._persist_handover_bundle_record',
            side_effect=record('persist'),
        ), patch(
            'backend.api.views.ensure_pipeline_snapshot_from_bundle',
            side_effect=record('snapshot'),
        ), patch(
            'backend.api.views.enqueue_icea_bridge_request_for_transaction',
            side_effect=record('bridge'),
        ):
            response = self.client.post(
                self.url,
                data=build_icea_bundle(bundle_id='bundle-order-001', patient_id='pat-order-001', unit_id='icu-a'),
                format='json',
                HTTP_IDEMPOTENCY_KEY='req-order-001',
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(order, ['outbox', 'persist', 'snapshot', 'bridge'])
