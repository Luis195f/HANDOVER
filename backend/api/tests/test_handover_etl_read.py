import json
import types
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from backend.api.clinical_storage import decrypt_bundle_document, encrypt_bundle_document
from backend.api.models import HandoverBundleRecord


class HandoverEtlReadTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tx_url = reverse("fhir-transaction")
        self.bundle = {
            "resourceType": "Bundle",
            "id": "bundle-001",
            "type": "transaction",
            "entry": [
                {
                    "request": {"method": "POST", "url": "Patient"},
                    "resource": {
                        "resourceType": "Patient",
                        "id": "patient-001",
                        "name": [{"family": "Test", "given": ["Paciente"]}],
                    },
                }
            ],
        }

    def _auth(self, *, roles, scopes, sub="auth0|svc", gty="client-credentials", include_gty=True):
        claims = {
            "sub": sub,
            "roles": roles,
            "permissions": scopes,
            "scope": " ".join(scopes),
        }
        if include_gty:
            claims["gty"] = gty
        user = types.SimpleNamespace(
            is_authenticated=True,
            claims=claims,
            sub=sub,
            username=sub,
        )
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer etl-token-value", HTTP_X_UNIT_ID="uci-1")

    @patch("backend.api.views._post_transaction_to_fhir")
    def test_post_transaction_persists_bundle_and_supports_idempotent_request_id(self, mock_post):
        self._auth(roles=["nurse"], scopes=["fhir:transaction", "handover:write"], gty="")
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_post.return_value = mock_response

        response_a = self.client.post(
            self.tx_url,
            data=self.bundle,
            format="json",
            HTTP_X_REQUEST_ID="req-001",
        )
        response_b = self.client.post(
            self.tx_url,
            data=self.bundle,
            format="json",
            HTTP_X_REQUEST_ID="req-001",
        )

        self.assertIn(response_a.status_code, (200, 201))
        self.assertIn(response_b.status_code, (200, 201))
        self.assertEqual(HandoverBundleRecord.objects.filter(request_id="req-001").count(), 1)

        record = HandoverBundleRecord.objects.get(request_id="req-001")
        self.assertEqual(record.bundle_id, "bundle-001")
        self.assertEqual(record.patient_id, "patient-001")

        read_url = reverse("handover-etl-read", kwargs={"bundle_id": "bundle-001"})
        self._auth(roles=["service_etl"], scopes=["handover:etl:read"])
        read_response = self.client.get(read_url)
        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(read_response["Content-Type"], "application/fhir+json")
        self.assertEqual(json.loads(read_response.content), decrypt_bundle_document(record.bundle_json))

    @patch("backend.api.views.ensure_pipeline_snapshot_from_bundle", side_effect=RuntimeError("snapshot down"))
    @patch("backend.api.views._post_transaction_to_fhir")
    def test_post_transaction_keeps_clinical_success_when_snapshot_persistence_fails(self, mock_post, _mock_snapshot):
        self._auth(roles=["nurse"], scopes=["fhir:transaction", "handover:write"], gty="")
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_post.return_value = mock_response

        response = self.client.post(
            self.tx_url,
            data=self.bundle,
            format="json",
            HTTP_X_REQUEST_ID="req-snapshot-fail",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(HandoverBundleRecord.objects.filter(request_id="req-snapshot-fail").count(), 1)

    def test_get_without_bearer_token_returns_401(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-000",
            patient_id="patient-000",
            unit_id="uci-0",
            request_id="req-000",
            bundle_json={"resourceType": "Bundle", "id": "bundle-000", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )

        response = self.client.get(reverse("handover-etl-read", kwargs={"bundle_id": "bundle-000"}))
        self.assertEqual(response.status_code, 401)

    def test_get_requires_scope(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-002",
            patient_id="patient-002",
            unit_id="uci-2",
            request_id="req-002",
            bundle_json={"resourceType": "Bundle", "id": "bundle-002", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self._auth(roles=["service_etl"], scopes=["fhir:transaction"])

        response = self.client.get(reverse("handover-etl-read", kwargs={"bundle_id": "bundle-002"}))
        self.assertEqual(response.status_code, 403)

    def test_get_with_valid_role_and_scope_returns_200_and_etag(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-003",
            patient_id="patient-003",
            unit_id="uci-3",
            request_id="req-003",
            bundle_json={"resourceType": "Bundle", "id": "bundle-003", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self._auth(roles=["admin"], scopes=["icea:etl:read"])
        url = reverse("handover-etl-read", kwargs={"bundle_id": "bundle-003"})

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("ETag", response)

        not_modified = self.client.get(url, HTTP_IF_NONE_MATCH=response["ETag"])
        self.assertEqual(not_modified.status_code, 304)

    def test_get_with_bearer_and_missing_gty_returns_403(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-004",
            patient_id="patient-004",
            unit_id="uci-4",
            request_id="req-004",
            bundle_json={"resourceType": "Bundle", "id": "bundle-004", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self._auth(roles=["service_etl"], scopes=["icea:etl:read"], include_gty=False)

        response = self.client.get(reverse("handover-etl-read", kwargs={"bundle_id": "bundle-004"}))
        self.assertEqual(response.status_code, 403)

    def test_get_with_bearer_and_non_client_credentials_gty_returns_403(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-006",
            patient_id="patient-006",
            unit_id="uci-6",
            request_id="req-006",
            bundle_json={"resourceType": "Bundle", "id": "bundle-006", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self._auth(roles=["service_etl"], scopes=["icea:etl:read"], gty="password")

        response = self.client.get(reverse("handover-etl-read", kwargs={"bundle_id": "bundle-006"}))
        self.assertEqual(response.status_code, 403)

    @patch("backend.api.views._post_transaction_to_fhir")
    def test_logs_do_not_expose_token_or_bundle_json(self, mock_post):
        self._auth(roles=["nurse"], scopes=["fhir:transaction", "handover:write"], gty="")
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_post.return_value = mock_response

        with self.assertLogs("backend.api.views", level="INFO") as captured:
            self.client.post(
                self.tx_url,
                data=self.bundle,
                format="json",
                HTTP_X_REQUEST_ID="dup-req",
            )
            self.client.post(
                self.tx_url,
                data=self.bundle,
                format="json",
                HTTP_X_REQUEST_ID="dup-req",
            )

        joined = "\n".join(captured.output)
        self.assertNotIn("etl-token-value", joined)
        self.assertNotIn("Authorization", joined)
        self.assertNotIn("patient-001", joined)

    def test_get_100_reads_without_errors(self):
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-005",
            patient_id="patient-005",
            unit_id="uci-5",
            request_id="req-005",
            bundle_json={"resourceType": "Bundle", "id": "bundle-005", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )
        self._auth(roles=["service_etl"], scopes=["icea:etl:read"])
        url = reverse("handover-etl-read", kwargs={"bundle_id": "bundle-005"})

        for _ in range(100):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)




    def test_get_reads_legacy_encrypted_bundle_after_env_key_is_enabled(self):
        with override_settings(SECRET_KEY='legacy-secret-key', HANDOVER_BUNDLE_ENCRYPTION_KEY=''):
            encrypted_bundle, metadata = encrypt_bundle_document(self.bundle)

        with override_settings(SECRET_KEY='legacy-secret-key', HANDOVER_BUNDLE_ENCRYPTION_KEY='env-bundle-key'):
            HandoverBundleRecord.objects.create(
                bundle_id='bundle-001',
                patient_id='patient-001',
                unit_id='uci-1',
                request_id='req-legacy-env-read',
                bundle_json=encrypted_bundle,
                encryption_metadata=metadata,
                expires_at=HandoverBundleRecord.default_expiry(),
            )
            self._auth(roles=['service_etl'], scopes=['handover:etl:read'])

            response = self.client.get(reverse('handover-etl-read', kwargs={'bundle_id': 'bundle-001'}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), self.bundle)

