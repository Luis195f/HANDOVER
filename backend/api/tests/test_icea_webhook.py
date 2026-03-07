import hmac
import os
import types
from hashlib import sha256
from unittest.mock import Mock, patch

import httpx
from django.core.management import call_command
from django.test import RequestFactory, TestCase
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.urls import reverse

from backend.api.icea import (
    attempt_icea_outbound_delivery,
    build_icea_signature_headers,
    build_icea_webhook_body,
    build_icea_webhook_payload,
)
from backend.api.models import IceaOutboundEvent


class IceaWebhookUnitTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.bundle = {
            "resourceType": "Bundle",
            "type": "transaction",
            "identifier": {"system": "urn:handover-pro:tx", "value": "bundle-tx-001"},
            "signature": [
                {
                    "type": [{"code": "signature"}],
                    "when": "2026-03-07T11:00:00Z",
                    "onBehalfOf": {
                        "reference": "Organization/icu-a",
                        "identifier": {"system": "urn:handover:unit-id", "value": "icu-a"},
                        "display": "icu-a",
                    },
                }
            ],
            "entry": [
                {
                    "fullUrl": "urn:uuid:patient-1",
                    "request": {"method": "POST", "url": "Patient"},
                    "resource": {"resourceType": "Patient", "id": "pat-001"},
                },
                {
                    "fullUrl": "urn:uuid:enc-1",
                    "request": {"method": "POST", "url": "Encounter"},
                    "resource": {"resourceType": "Encounter", "id": "enc-001"},
                },
                {
                    "fullUrl": "urn:uuid:comp-1",
                    "request": {"method": "POST", "url": "Composition"},
                    "resource": {
                        "resourceType": "Composition",
                        "id": "comp-001",
                        "subject": {"reference": "urn:uuid:patient-1"},
                        "encounter": {"reference": "urn:uuid:enc-1"},
                    },
                },
            ],
        }

    def test_signature_headers_are_stable_for_canonical_body(self):
        payload = {"z": 1, "a": 2}
        raw_body = build_icea_webhook_body(payload)

        headers = build_icea_signature_headers(
            raw_body,
            secret="shared-secret",
            anti_replay=False,
            idempotency_key="req-001",
        )

        self.assertEqual(raw_body, b'{"a":2,"z":1}')
        expected = hmac.new(b"shared-secret", raw_body, sha256).hexdigest()
        self.assertEqual(headers["X-ICEA-Signature"], f"sha256={expected}")
        self.assertEqual(headers["Idempotency-Key"], "req-001")
        self.assertNotIn("X-ICEA-Timestamp", headers)
        self.assertNotIn("X-ICEA-Nonce", headers)

    def test_signature_headers_include_anti_replay_prefix(self):
        payload = {"bundleId": "bundle-tx-001"}
        raw_body = build_icea_webhook_body(payload)

        headers = build_icea_signature_headers(
            raw_body,
            secret="shared-secret",
            anti_replay=True,
            idempotency_key="req-002",
            timestamp="1700000000",
            nonce="123e4567-e89b-12d3-a456-426614174000",
        )

        expected_input = b"1700000000.123e4567-e89b-12d3-a456-426614174000." + raw_body
        expected = hmac.new(b"shared-secret", expected_input, sha256).hexdigest()
        self.assertEqual(headers["X-ICEA-Signature"], f"sha256={expected}")
        self.assertEqual(headers["X-ICEA-Timestamp"], "1700000000")
        self.assertEqual(headers["X-ICEA-Nonce"], "123e4567-e89b-12d3-a456-426614174000")

    def test_build_payload_uses_bundle_ids_and_request_headers(self):
        request = self.factory.post(
            "/api/fhir/transaction",
            data={},
            HTTP_IDEMPOTENCY_KEY="req-icea-001",
            HTTP_X_UNIT_ID="icu-a",
        )
        request.audit_request_id = "audit-req-001"

        payload = build_icea_webhook_payload(self.bundle, request)

        self.assertEqual(payload["bundleId"], "bundle-tx-001")
        self.assertEqual(payload["patientId"], "pat-001")
        self.assertEqual(payload["unitId"], "icu-a")
        self.assertEqual(payload["requestId"], "req-icea-001")
        self.assertEqual(payload["encounterId"], "enc-001")
        self.assertEqual(payload["compositionId"], "comp-001")
        self.assertEqual(payload["bundleIdentifier"], "bundle-tx-001")
        self.assertEqual(payload["source"], "HANDOVER")
        self.assertTrue(payload["timestamp"].endswith("Z"))


class IceaWebhookIntegrationTests(TestCase):
    def setUp(self):
        from rest_framework.permissions import AllowAny
        from rest_framework.test import APIClient
        from backend.api.views import BundleView

        self.client = APIClient()
        self.url = reverse("fhir-transaction")
        self.request_factory = RequestFactory()

        User = get_user_model()
        self.user = User.objects.create_user(username="icea-user", password="testpass")
        claims = {
            "sub": "auth0|icea-user",
            "permissions": ["fhir:transaction", "handover:write"],
            "scope": "fhir:transaction handover:write",
            "roles": ["nurse"],
        }
        auth_user = types.SimpleNamespace(
            is_authenticated=True,
            claims=claims,
            sub="auth0|icea-user",
            username="auth0|icea-user",
        )
        self.client.force_authenticate(user=auth_user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")

        self._perm_patcher = patch.object(BundleView, "permission_classes", [AllowAny])
        self._auth_patcher = patch.object(BundleView, "authentication_classes", [])
        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

        self.valid_bundle = {
            "resourceType": "Bundle",
            "type": "transaction",
            "identifier": {"system": "urn:handover-pro:tx", "value": "bundle-tx-001"},
            "signature": [
                {
                    "type": [{"code": "signature"}],
                    "when": "2026-03-07T11:00:00Z",
                    "onBehalfOf": {
                        "reference": "Organization/icu-a",
                        "identifier": {"system": "urn:handover:unit-id", "value": "icu-a"},
                        "display": "icu-a",
                    },
                }
            ],
            "entry": [
                {
                    "request": {"method": "POST", "url": "Patient"},
                    "resource": {"resourceType": "Patient", "id": "pat-001"},
                },
                {
                    "request": {"method": "POST", "url": "Encounter"},
                    "resource": {
                        "resourceType": "Encounter",
                        "id": "enc-001",
                        "subject": {"reference": "Patient/pat-001"},
                    },
                },
                {
                    "request": {"method": "POST", "url": "Composition"},
                    "resource": {
                        "resourceType": "Composition",
                        "id": "comp-001",
                        "subject": {"reference": "Patient/pat-001"},
                        "encounter": {"reference": "Encounter/enc-001"},
                    },
                },
            ],
        }

    def _fhir_response(self, status_code=201):
        response = Mock()
        response.status_code = status_code
        response.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        response.text = '{"resourceType":"Bundle","type":"transaction-response"}'
        return response

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
            "ICEA_WEBHOOK_TIMEOUT_MS": "2500",
            "ICEA_WEBHOOK_RETRY_MAX": "5",
        },
        clear=False,
    )
    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.icea.httpx.post")
    @patch("backend.api.views.httpx.post")
    def test_successful_transaction_creates_outbox_and_posts_webhook(
        self,
        mock_fhir_post,
        mock_icea_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = self._fhir_response()
        mock_icea_response = Mock()
        mock_icea_response.status_code = 202
        mock_icea_post.return_value = mock_icea_response

        response = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_IDEMPOTENCY_KEY="tx-icea-001",
        )

        self.assertEqual(response.status_code, 201)
        event = IceaOutboundEvent.objects.get()
        self.assertEqual(event.request_id, "tx-icea-001")
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_SENT)
        self.assertEqual(event.bundle_id, "bundle-tx-001")
        self.assertEqual(event.patient_id, "pat-001")
        self.assertEqual(event.unit_id, "icu-a")
        self.assertEqual(mock_icea_post.call_count, 1)

        _, kwargs = mock_icea_post.call_args
        self.assertEqual(kwargs["content"], build_icea_webhook_body(event.payload_json))
        self.assertEqual(kwargs["headers"]["Idempotency-Key"], "tx-icea-001")
        self.assertTrue(kwargs["headers"]["X-ICEA-Signature"].startswith("sha256="))
        self.assertNotIn("pat-001", kwargs["headers"]["X-ICEA-Signature"])

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.icea.httpx.post")
    @patch("backend.api.views.httpx.post")
    def test_fhir_failure_does_not_create_or_send_webhook(
        self,
        mock_fhir_post,
        mock_icea_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = self._fhir_response(status_code=500)

        response = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_IDEMPOTENCY_KEY="tx-icea-002",
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(IceaOutboundEvent.objects.count(), 0)
        self.assertEqual(mock_icea_post.call_args_list, [])

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.icea.httpx.post")
    def test_retry_failure_marks_pending_and_flush_command_can_deliver(self, mock_icea_post):
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-003",
            bundle_id="bundle-tx-003",
            patient_id="pat-003",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-003",
                "patientId": "pat-003",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-003",
                "source": "HANDOVER",
            },
        )

        mock_icea_post.side_effect = httpx.ConnectTimeout("network down")
        result = attempt_icea_outbound_delivery(event)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_PENDING)
        self.assertIsNotNone(event.next_retry_at)
        self.assertEqual(event.last_error, "ConnectTimeout")

        event.next_retry_at = timezone.now() - timezone.timedelta(seconds=1)
        event.save(update_fields=["next_retry_at"])

        mock_icea_post.side_effect = None
        success_response = Mock()
        success_response.status_code = 204
        mock_icea_post.return_value = success_response

        call_command("flush_icea_outbox", limit=10)
        event.refresh_from_db()

        self.assertEqual(event.status, IceaOutboundEvent.STATUS_SENT)
        self.assertIsNotNone(event.sent_at)
        self.assertEqual(event.attempts, 2)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "super-secret-token",
        },
        clear=False,
    )
    @patch("backend.api.icea.httpx.post")
    def test_delivery_logs_do_not_include_secret_or_clinical_payload(self, mock_icea_post):
        mock_icea_post.side_effect = httpx.ConnectTimeout("network down")
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-004",
            bundle_id="bundle-tx-004",
            patient_id="pat-004",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-004",
                "patientId": "pat-004",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-004",
                "source": "HANDOVER",
                "notes": "Sensitive Patient Narrative",
            },
        )

        with self.assertLogs("backend.api.icea", level="INFO") as captured:
            attempt_icea_outbound_delivery(event)

        joined = "\n".join(captured.output)
        self.assertNotIn("Sensitive Patient Narrative", joined)
        self.assertNotIn("super-secret-token", joined)
        self.assertIn("icea_webhook_delivery", joined)



