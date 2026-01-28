# backend/api/tests/test_handover_api.py
from django.test import TestCase
from django.urls import reverse
from django.contrib.auth import get_user_model
from unittest.mock import patch, Mock

try:
    from rest_framework.test import APIClient
except Exception:
    APIClient = None


class HandoverApiTests(TestCase):
    def setUp(self):
        self.client = APIClient() if APIClient else None
        self.url = reverse("fhir-transaction")

        User = get_user_model()
        self.user = User.objects.create_user(username="testuser", password="testpass")
        if self.client:
            self.client.force_authenticate(user=self.user)

        # ✅ Bypass roles permission (RequireRolesPermission) en este test
        from backend.api import views as api_views
        self._perm_patcher = patch.object(
            api_views.AuthenticatedAPIView,
            "permission_classes",
            [api_views.IsAuthenticated],  # o [api_views.AllowAny]
        )
        self._perm_patcher.start()
        self.addCleanup(self._perm_patcher.stop)

        self.valid_bundle = {
            "resourceType": "Bundle",
            "type": "transaction",
            "entry": [
                {
                    "request": {"method": "POST", "url": "Patient"},
                    "resource": {
                        "resourceType": "Patient",
                        "id": "pat-test-001",
                        "name": [{"use": "official", "family": "Test", "given": ["Paciente"]}],
                        "gender": "unknown",
                    },
                }
            ],
        }

    def _post(self, payload):
        if self.client:
            return self.client.post(self.url, data=payload, format="json")

        import json
        from django.test import Client
        c = Client()
        return c.post(self.url, data=json.dumps(payload), content_type="application/fhir+json")

    def test_post_bundle_invalid(self):
        bad_bundle = {
            "resourceType": "Bundle",
            "type": "collection",  # fuerza 422 por tu lógica
            "entry": [{"resource": {}}],
        }
        resp = self._post(bad_bundle)
        self.assertEqual(
            resp.status_code,
            422,
            msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}",
        )

    @patch("backend.api.views.httpx.post", autospec=True)
    def test_post_bundle_success(self, mock_httpx_post):
        mock_resp = Mock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_resp.text = '{"resourceType":"Bundle","type":"transaction-response"}'
        mock_httpx_post.return_value = mock_resp

        resp = self._post(self.valid_bundle)
        self.assertIn(
            resp.status_code,
            (200, 201),
            msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}",
        )
