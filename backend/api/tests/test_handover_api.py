# backend/api/tests/test_handover_api.py
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from unittest.mock import Mock, patch


class HandoverApiTests(TestCase):
    def setUp(self):
        # Import lazy para no romper pytest collection
        try:
            from rest_framework.test import APIClient  # type: ignore
        except Exception:
            APIClient = None  # noqa: N806

        self.client = APIClient() if APIClient else None
        self.url = reverse("fhir-transaction")

        User = get_user_model()
        self.user = User.objects.create_user(username="testuser", password="testpass")

        if self.client:
            # Autenticación de usuario Django (aunque luego bypass en view)
            self.client.force_authenticate(user=self.user)

            # ✅ IMPORTANTE: el backend ahora exige token de usuario para reenviar a FHIR
            # (aunque se bypassen authenticators/perms)
            self.client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")

        # ✅ BYPASS auth/permissions SOLO para estos tests del endpoint fhir-transaction
        from backend.api import views as api_views

        try:
            from rest_framework.permissions import AllowAny  # type: ignore
        except Exception:
            AllowAny = None  # noqa: N806

        # Si existe BundleView, la parchamos; si no, parchamos base AuthenticatedAPIView
        target_cls = getattr(api_views, "BundleView", None) or getattr(api_views, "AuthenticatedAPIView", None)
        if target_cls is None:
            raise RuntimeError("No se encontró BundleView ni AuthenticatedAPIView en backend.api.views")

        self._perm_patcher = patch.object(
            target_cls,
            "permission_classes",
            [AllowAny] if AllowAny else [],
        )
        self._auth_patcher = patch.object(
            target_cls,
            "authentication_classes",
            [],  # importantísimo: evita authenticators reales (Auth0/scopes) en estos tests
        )

        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

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
        # DRF APIClient: NO mezclar format con content_type
        if self.client:
            return self.client.post(self.url, data=payload, format="json")

        # Django Client fallback
        import json
        from django.test import Client

        c = Client()
        return c.post(
            self.url,
            data=json.dumps(payload),
            content_type="application/fhir+json",
            HTTP_AUTHORIZATION="Bearer test-access-token",
        )

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
