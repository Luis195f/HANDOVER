# backend/api/tests/test_handover_api.py
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.test.utils import override_settings
from django.urls import reverse
from unittest.mock import Mock, patch
import types


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
            # Usuario autenticado con subject para tests base del endpoint
            base_claims = {
                "sub": "auth0|base-test-user",
                "permissions": ["fhir:transaction", "handover:write"],
                "scope": "fhir:transaction handover:write",
                "roles": ["nurse"],
            }
            base_user = types.SimpleNamespace(
                is_authenticated=True,
                claims=base_claims,
                sub="auth0|base-test-user",
                username="auth0|base-test-user",
            )
            self.client.force_authenticate(user=base_user, token=base_claims)

            # ✅ IMPORTANTE: el backend exige token de usuario para reenviar a FHIR
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

    def _claims_user(self, sub: str = "auth0|real-sub", include_user_sub: bool = True):
        claims = {
            "sub": sub,
            "permissions": ["fhir:transaction", "handover:write"],
            "scope": "fhir:transaction handover:write",
            "roles": ["nurse"],
        }
        user_kwargs = {
            "is_authenticated": True,
            "claims": claims,
            "username": sub,
        }
        if include_user_sub:
            user_kwargs["sub"] = sub
        user = types.SimpleNamespace(**user_kwargs)
        return user, claims

    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.views._ensure_bundle_signature", autospec=True)
    @patch("backend.api.views.httpx.post", autospec=True)
    def test_ignores_spoofed_x_user_id_header_uses_authenticated_sub(
        self,
        mock_httpx_post,
        mock_ensure_signature,
        mock_create_audit,
    ):
        user, claims = self._claims_user("auth0|real-user")
        self.client.force_authenticate(user=user, token=claims)

        mock_ensure_signature.return_value = None
        mock_resp = Mock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_httpx_post.return_value = mock_resp

        resp = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_AUTHORIZATION="Bearer test-access-token",
            HTTP_X_USER_ID="attacker|spoofed",
        )

        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(mock_ensure_signature.call_args.args[1], "auth0|real-user")
        self.assertEqual(mock_create_audit.call_args.kwargs["user_id"], "auth0|real-user")

    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.views._ensure_bundle_signature", autospec=True)
    @patch("backend.api.views.httpx.post", autospec=True)
    def test_without_x_user_id_header_uses_claim_sub_when_user_sub_missing(
        self,
        mock_httpx_post,
        mock_ensure_signature,
        mock_create_audit,
    ):
        user, claims = self._claims_user("auth0|claims-sub", include_user_sub=False)
        self.client.force_authenticate(user=user, token=claims)

        mock_ensure_signature.return_value = None
        mock_resp = Mock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_httpx_post.return_value = mock_resp

        resp = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_AUTHORIZATION="Bearer test-access-token",
        )

        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(mock_ensure_signature.call_args.args[1], "auth0|claims-sub")
        self.assertEqual(mock_create_audit.call_args.kwargs["user_id"], "auth0|claims-sub")


    @override_settings(DEBUG=False)
    @patch("backend.api.views.httpx.post", autospec=True)
    def test_bearer_without_authenticated_sub_returns_401(self, mock_httpx_post):
        claims = {
            "permissions": ["fhir:transaction", "handover:write"],
            "scope": "fhir:transaction handover:write",
            "roles": ["nurse"],
        }
        user = types.SimpleNamespace(
            is_authenticated=True,
            claims=claims,
            username="no-sub-user",
        )
        self.client.force_authenticate(user=user, token=claims)

        resp = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_AUTHORIZATION="Bearer test-access-token",
        )

        self.assertEqual(resp.status_code, 401)
        mock_httpx_post.assert_not_called()

    @override_settings(DEBUG=False)
    @patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
    @patch("backend.api.views._ensure_bundle_signature", autospec=True)
    @patch("backend.api.views.httpx.post", autospec=True)
    def test_production_mode_does_not_accept_x_user_id_as_actor(
        self,
        mock_httpx_post,
        mock_ensure_signature,
        mock_create_audit,
    ):
        user, claims = self._claims_user("auth0|prod-real")
        self.client.force_authenticate(user=user, token=claims)

        mock_ensure_signature.return_value = None
        mock_resp = Mock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_httpx_post.return_value = mock_resp

        resp = self.client.post(
            self.url,
            data=self.valid_bundle,
            format="json",
            HTTP_AUTHORIZATION="Bearer test-access-token",
            HTTP_X_USER_ID="auth0|spoofed-prod",
        )

        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(mock_ensure_signature.call_args.args[1], "auth0|prod-real")
        self.assertEqual(mock_create_audit.call_args.kwargs["user_id"], "auth0|prod-real")
