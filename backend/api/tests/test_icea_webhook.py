import hmac
import os
import types
from hashlib import sha256
from unittest.mock import Mock, patch

import httpx
from django.conf import settings
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone

from backend.api.icea import (
    attempt_icea_outbound_delivery,
    build_icea_webhook_payload,
    enqueue_icea_outbound_event_for_transaction,
    safe_icea_event_summary,
)
from backend.api.icea_client import (
    build_icea_signature_headers,
    build_icea_webhook_body,
    load_icea_webhook_settings,
)
from backend.api.models import IceaOutboundEvent
from backend.api.tests.icea_test_utils import (
    build_authenticated_api_user,
    build_fhir_response,
    build_icea_bundle,
)


class IceaWebhookUnitTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.bundle = build_icea_bundle()

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
        self.assertEqual(payload["encounterId"], "enc-tx-001")
        self.assertEqual(payload["compositionId"], "comp-tx-001")
        self.assertEqual(payload["bundleIdentifier"], "bundle-tx-001")
        self.assertEqual(payload["source"], "HANDOVER")
        self.assertTrue(payload["timestamp"].endswith("Z"))

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "http://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.icea_client._running_tests", return_value=False)
    def test_settings_require_https_outside_debug(self, _mock_running_tests):
        with patch.object(settings, "DEBUG", False):
            config = load_icea_webhook_settings()

        self.assertTrue(config.enabled)
        self.assertIn("webhook_url_https_required", config.validation_errors)
        self.assertFalse(config.configured)

    def test_safe_event_summary_hashes_sensitive_ids(self):
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-summary",
            idempotency_key="tx-icea-summary",
            bundle_id="bundle-sensitive",
            patient_id="pat-sensitive",
            unit_id="icu-sensitive",
            payload_json={"requestId": "tx-icea-summary"},
        )

        summary = safe_icea_event_summary(event, detail="http_503")

        self.assertEqual(summary["request_id"], "tx-icea-summary")
        self.assertEqual(summary["idempotency_key"], "tx-icea-summary")
        self.assertNotEqual(summary["bundle_hash"], "bundle-sensitive")
        self.assertNotEqual(summary["patient_hash"], "pat-sensitive")
        self.assertNotEqual(summary["unit_hash"], "icu-sensitive")
        self.assertEqual(summary["detail"], "http_503")

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.icea.schedule_icea_outbound_event_delivery")
    @patch("backend.api.icea.sync_pipeline_snapshot_from_outbound_event", side_effect=RuntimeError("snapshot down"))
    def test_enqueue_keeps_event_queued_when_snapshot_sync_fails(self, _mock_sync, mock_schedule):
        request = self.factory.post(
            "/api/fhir/transaction",
            data={},
            HTTP_IDEMPOTENCY_KEY="tx-icea-queued",
            HTTP_X_UNIT_ID="icu-a",
        )
        request.audit_request_id = "audit-queued"

        event = enqueue_icea_outbound_event_for_transaction(bundle=self.bundle, request=request)

        self.assertIsNotNone(event)
        event = IceaOutboundEvent.objects.get(request_id="tx-icea-queued")
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_QUEUED)
        self.assertEqual(event.request_id, "tx-icea-queued")
        mock_schedule.assert_called_once_with(event.id)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
            "ICEA_WEBHOOK_RETRY_MAX": "5",
        },
        clear=False,
    )
    @patch("backend.api.icea.sync_pipeline_snapshot_from_outbound_event", side_effect=RuntimeError("snapshot down"))
    @patch("backend.api.icea_client._post_to_icea")
    def test_retry_status_survives_snapshot_sync_failure(self, mock_icea_post, _mock_sync):
        response = Mock()
        response.status_code = 503
        response.text = '{"detail":"temporarily unavailable"}'
        response.headers = {"Content-Type": "application/json"}
        response.json.return_value = {"detail": "temporarily unavailable"}
        mock_icea_post.return_value = response
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-retry-safe",
            idempotency_key="tx-icea-retry-safe",
            bundle_id="bundle-tx-retry-safe",
            patient_id="pat-retry-safe",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-retry-safe",
                "patientId": "pat-retry-safe",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-retry-safe",
                "source": "HANDOVER",
            },
        )

        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_RETRY)
        self.assertIsNotNone(event.next_retry_at)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
            "ICEA_WEBHOOK_RETRY_MAX": "1",
        },
        clear=False,
    )
    @patch("backend.api.icea.sync_pipeline_snapshot_from_outbound_event", side_effect=RuntimeError("snapshot down"))
    @patch("backend.api.icea_client._post_to_icea")
    def test_failed_status_survives_snapshot_sync_failure(self, mock_icea_post, _mock_sync):
        response = Mock()
        response.status_code = 503
        response.text = '{"detail":"temporarily unavailable"}'
        response.headers = {"Content-Type": "application/json"}
        response.json.return_value = {"detail": "temporarily unavailable"}
        mock_icea_post.return_value = response
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-failed-safe",
            idempotency_key="tx-icea-failed-safe",
            bundle_id="bundle-tx-failed-safe",
            patient_id="pat-failed-safe",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-failed-safe",
                "patientId": "pat-failed-safe",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-failed-safe",
                "source": "HANDOVER",
            },
        )

        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_FAILED)
        self.assertIsNone(event.next_retry_at)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.icea.sync_pipeline_snapshot_from_outbound_event", side_effect=RuntimeError("snapshot down"))
    @patch("backend.api.icea_client._post_to_icea")
    def test_delivered_status_survives_snapshot_sync_failure(self, mock_icea_post, _mock_sync):
        response = Mock()
        response.status_code = 202
        response.text = '{"status":"accepted"}'
        response.headers = {"Content-Type": "application/json"}
        response.json.return_value = {"status": "accepted"}
        mock_icea_post.return_value = response
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-delivered-safe",
            idempotency_key="tx-icea-delivered-safe",
            bundle_id="bundle-tx-delivered-safe",
            patient_id="pat-delivered-safe",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-delivered-safe",
                "patientId": "pat-delivered-safe",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-delivered-safe",
                "source": "HANDOVER",
            },
        )

        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertTrue(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_DELIVERED)
        self.assertIsNotNone(event.delivered_at)


class IceaWebhookIntegrationTests(TestCase):
    def setUp(self):
        from rest_framework.permissions import AllowAny
        from rest_framework.test import APIClient
        from backend.api.views import BundleView

        self.client = APIClient()
        self.url = reverse("fhir-transaction")

        User = get_user_model()
        self.user = User.objects.create_user(username="icea-user", password="testpass")
        auth_user, claims = build_authenticated_api_user(
            sub="auth0|icea-user",
            roles=["nurse"],
            scopes=["fhir:transaction", "handover:write"],
        )
        self.client.force_authenticate(user=auth_user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")

        self._perm_patcher = patch.object(BundleView, "permission_classes", [AllowAny])
        self._auth_patcher = patch.object(BundleView, "authentication_classes", [])
        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

        self.valid_bundle = build_icea_bundle()

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
    @patch("backend.api.icea_client._post_to_icea")
    @patch("backend.api.views._post_transaction_to_fhir")
    def test_successful_transaction_creates_outbox_and_posts_webhook(
        self,
        mock_fhir_post,
        mock_icea_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = build_fhir_response()
        mock_icea_response = Mock()
        mock_icea_response.status_code = 202
        mock_icea_response.text = '{"status":"accepted"}'
        mock_icea_response.headers = {"Content-Type": "application/json"}
        mock_icea_response.json.return_value = {"status": "accepted"}
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
        self.assertEqual(event.idempotency_key, "tx-icea-001")
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_DELIVERED)
        self.assertEqual(event.last_http_status, 202)
        self.assertEqual(event.bundle_id, "bundle-tx-001")
        self.assertEqual(event.patient_id, "pat-001")
        self.assertEqual(event.unit_id, "icu-a")
        self.assertIsNotNone(event.delivered_at)
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
    @patch("backend.api.icea_client._post_to_icea")
    @patch("backend.api.views._post_transaction_to_fhir")
    def test_fhir_failure_does_not_create_or_send_webhook(
        self,
        mock_fhir_post,
        mock_icea_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = build_fhir_response(status_code=500)

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
            "ICEA_WEBHOOK_RETRY_MAX": "5",
        },
        clear=False,
    )
    @patch("backend.api.icea_client._post_to_icea")
    def test_retryable_http_status_schedules_retry_and_persists_http_status(self, mock_icea_post):
        response = Mock()
        response.status_code = 503
        response.text = '{"detail":"temporarily unavailable"}'
        response.headers = {"Content-Type": "application/json"}
        response.json.return_value = {"detail": "temporarily unavailable"}
        mock_icea_post.return_value = response
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-003",
            idempotency_key="tx-icea-003",
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

        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_RETRY)
        self.assertEqual(event.last_http_status, 503)
        self.assertEqual(event.last_error, "temporarily unavailable")
        self.assertIsNotNone(event.next_retry_at)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
        },
        clear=False,
    )
    @patch("backend.api.icea_client._post_to_icea")
    def test_transport_retry_and_flush_command_can_deliver(self, mock_icea_post):
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-004",
            idempotency_key="tx-icea-004",
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
            },
        )

        mock_icea_post.side_effect = httpx.ConnectTimeout("network down")
        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_RETRY)
        self.assertIsNotNone(event.next_retry_at)
        self.assertEqual(event.last_error, "ConnectTimeout")

        mock_icea_post.side_effect = None
        success_response = Mock()
        success_response.status_code = 204
        success_response.text = ""
        success_response.headers = {}
        success_response.json.side_effect = ValueError("empty")
        mock_icea_post.return_value = success_response

        call_command("flush_icea_outbox", limit=10, force=True)
        event.refresh_from_db()

        self.assertEqual(event.status, IceaOutboundEvent.STATUS_DELIVERED)
        self.assertIsNotNone(event.delivered_at)
        self.assertEqual(event.attempts, 2)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "http://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "shared-secret",
            "ICEA_WEBHOOK_RETRY_MAX": "2",
        },
        clear=False,
    )
    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.views._post_transaction_to_fhir")
    @patch("backend.api.icea_client._running_tests", return_value=False)
    def test_invalid_config_keeps_delivery_non_blocking_and_auditable(
        self,
        _mock_running_tests,
        mock_fhir_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = build_fhir_response()

        with patch.object(settings, "DEBUG", False):
            response = self.client.post(
                self.url,
                data=self.valid_bundle,
                format="json",
                HTTP_IDEMPOTENCY_KEY="tx-icea-005",
            )

        self.assertEqual(response.status_code, 201)
        event = IceaOutboundEvent.objects.get(request_id="tx-icea-005")
        self.assertEqual(event.idempotency_key, "tx-icea-005")
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_RETRY)
        self.assertEqual(event.attempts, 1)
        self.assertIsNotNone(event.last_attempt_at)
        self.assertEqual(event.last_error, "webhook_url_https_required")

        result = attempt_icea_outbound_delivery(event, force=True)
        event.refresh_from_db()

        self.assertFalse(result.delivered)
        self.assertEqual(result.status, IceaOutboundEvent.STATUS_FAILED)
        self.assertEqual(event.status, IceaOutboundEvent.STATUS_FAILED)
        self.assertEqual(event.attempts, 2)
        self.assertIsNotNone(event.last_attempt_at)

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
    @patch("backend.api.icea_client._post_to_icea")
    @patch("backend.api.views._post_transaction_to_fhir")
    def test_duplicate_transaction_request_keeps_single_outbox_event(
        self,
        mock_fhir_post,
        mock_icea_post,
        _mock_audit_event,
    ):
        mock_fhir_post.return_value = build_fhir_response()
        success_response = Mock()
        success_response.status_code = 202
        success_response.text = '{"status":"accepted"}'
        success_response.headers = {"Content-Type": "application/json"}
        success_response.json.return_value = {"status": "accepted"}
        mock_icea_post.return_value = success_response

        response_a = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_IDEMPOTENCY_KEY="tx-icea-006",
        )
        response_b = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_IDEMPOTENCY_KEY="tx-icea-006",
        )

        self.assertEqual(response_a.status_code, 201)
        self.assertEqual(response_b.status_code, 201)
        self.assertEqual(IceaOutboundEvent.objects.filter(request_id="tx-icea-006").count(), 1)
        self.assertEqual(mock_icea_post.call_count, 1)

    @patch.dict(
        os.environ,
        {
            "ICEA_WEBHOOK_ENABLED": "true",
            "ICEA_WEBHOOK_URL": "https://icea.example/api/v1/pipeline/ingest/",
            "ICEA_WEBHOOK_SECRET": "super-secret-token",
        },
        clear=False,
    )
    @patch("backend.api.icea_client._post_to_icea")
    def test_delivery_logs_do_not_include_secret_or_clinical_payload(self, mock_icea_post):
        mock_icea_post.side_effect = httpx.ConnectTimeout("network down")
        event = IceaOutboundEvent.objects.create(
            request_id="tx-icea-007",
            idempotency_key="tx-icea-007",
            bundle_id="bundle-tx-007",
            patient_id="pat-007",
            unit_id="icu-a",
            payload_json={
                "bundleId": "bundle-tx-007",
                "patientId": "pat-007",
                "unitId": "icu-a",
                "timestamp": "2026-03-07T12:00:00Z",
                "requestId": "tx-icea-007",
                "source": "HANDOVER",
                "notes": "Sensitive Patient Narrative",
            },
        )

        with self.assertLogs("backend.api.icea", level="INFO") as captured:
            attempt_icea_outbound_delivery(event)

        joined = "\n".join(captured.output)
        self.assertNotIn("Sensitive Patient Narrative", joined)
        self.assertNotIn("super-secret-token", joined)
        self.assertNotIn("pat-007", joined)
        self.assertIn("icea_outbound_delivery", joined)








