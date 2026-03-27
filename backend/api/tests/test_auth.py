from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.test import APIClient, APIRequestFactory

from backend.api.views import AuthenticatedAPIView
from backend.security.auth import Auth0User
from backend.security.scopes import CLINICAL_SCOPES, FHIR_PROFILES


class AuthEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.factory = APIRequestFactory()
        self.capabilities_url = reverse("me-capabilities")
        self.refresh_url = reverse("auth-refresh")

    def _base_view(self) -> AuthenticatedAPIView:
        view = AuthenticatedAPIView()
        view.request = self.factory.get("/api/protected")
        return view

    @override_settings(DEBUG=False)
    def test_me_capabilities_requires_bearer_token_in_production(self):
        response = self.client.get(self.capabilities_url)

        self.assertEqual(response.status_code, 401)

    @override_settings(DEBUG=False, AUTH0_CONFIGURED=False)
    def test_authenticated_api_view_fails_closed_when_auth0_missing_outside_local_test(self):
        with patch.object(AuthenticatedAPIView, "_running_tests", return_value=False):
            view = self._base_view()

            permissions = view.get_permissions()
            authenticators = view.get_authenticators()

        self.assertEqual(len(permissions), 1)
        self.assertIsInstance(permissions[0], IsAuthenticated)
        self.assertEqual(len(authenticators), 1)
        self.assertIsInstance(authenticators[0], view.authentication_classes[0])

    @override_settings(DEBUG=True, AUTH0_CONFIGURED=False)
    def test_authenticated_api_view_allows_explicit_local_debug_without_auth0(self):
        with patch.object(AuthenticatedAPIView, "_running_tests", return_value=False):
            view = self._base_view()

            permissions = view.get_permissions()
            authenticators = view.get_authenticators()

        self.assertEqual(len(permissions), 1)
        self.assertIsInstance(permissions[0], AllowAny)
        self.assertEqual(authenticators, [])

    @override_settings(DEBUG=False, AUTH0_CONFIGURED=False)
    def test_authenticated_api_view_allows_only_explicit_test_bypass(self):
        with patch.object(AuthenticatedAPIView, "_running_tests", return_value=True):
            view = self._base_view()

            permissions = view.get_permissions()
            authenticators = view.get_authenticators()

        self.assertEqual(len(permissions), 1)
        self.assertIsInstance(permissions[0], AllowAny)
        self.assertEqual(authenticators, [])

    @override_settings(DEBUG=False, AUTH0_CONFIGURED=True)
    def test_authenticated_api_view_keeps_normal_auth_flow_when_configured(self):
        with patch.object(AuthenticatedAPIView, "_running_tests", return_value=False):
            view = self._base_view()

            permissions = view.get_permissions()
            authenticators = view.get_authenticators()

        self.assertEqual(len(permissions), 1)
        self.assertIsInstance(permissions[0], IsAuthenticated)
        self.assertEqual(len(authenticators), 1)
        self.assertIsInstance(authenticators[0], view.authentication_classes[0])

    @override_settings(DEBUG=False)
    @patch(
        "backend.api.views.Auth0JWTAuthentication.authenticate",
        side_effect=AuthenticationFailed("Invalid token"),
    )
    def test_me_capabilities_rejects_invalid_token(self, _mock_authenticate):
        response = self.client.get(
            self.capabilities_url,
            HTTP_AUTHORIZATION="Bearer invalid-token",
        )

        self.assertEqual(response.status_code, 401)

    @override_settings(DEBUG=False)
    @patch("backend.api.views.Auth0JWTAuthentication.authenticate")
    def test_me_capabilities_returns_effective_claims_for_valid_token(self, mock_authenticate):
        claims = {
            "sub": "auth0|cap-user",
            "roles": ["supervisor"],
            "permissions": ["handover:write", "audit:read"],
        }
        mock_authenticate.return_value = (Auth0User(sub=claims["sub"], claims=claims), claims)

        response = self.client.get(
            self.capabilities_url,
            HTTP_AUTHORIZATION="Bearer valid-token",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "userSub": "auth0|cap-user",
                "roles": ["supervisor"],
                "scopes": ["audit:read", "handover:write"],
                "permissions": {
                    "canWriteHandover": True,
                    "canSignHandover": True,
                    "canViewAudit": True,
                    "canSendAuditEvents": True,
                    "isAdmin": False,
                },
                "scopeCatalog": CLINICAL_SCOPES,
                "fhir": {"version": "R4", "transaction": True, "profiles": FHIR_PROFILES},
            },
        )

    def test_auth_refresh_returns_500_when_oidc_refresh_not_configured(self):
        response = self.client.post(self.refresh_url, data={}, format="json")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["errors"], ["OIDC refresh endpoint not configured."])

    def test_auth_refresh_requires_refresh_token_when_oidc_is_configured(self):
        with patch.multiple(
            "backend.api.views",
            OIDC_TOKEN_URL="https://issuer.example/token",
            OIDC_CLIENT_ID="handover-client",
            OIDC_CLIENT_SECRET="super-secret",
            OIDC_SCOPE="openid profile offline_access",
        ):
            response = self.client.post(self.refresh_url, data={}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"], ["Missing refresh_token."])

    @patch("backend.api.views.httpx.post", autospec=True)
    def test_auth_refresh_exchanges_refresh_token_with_configured_form(self, mock_post):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 3600,
        }
        mock_post.return_value = mock_response

        with patch.multiple(
            "backend.api.views",
            OIDC_TOKEN_URL="https://issuer.example/token",
            OIDC_CLIENT_ID="handover-client",
            OIDC_CLIENT_SECRET="super-secret",
            OIDC_SCOPE="openid profile offline_access",
        ):
            response = self.client.post(
                self.refresh_url,
                data={"refresh_token": "refresh-123"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["access_token"], "new-access")
        mock_post.assert_called_once()
        self.assertEqual(
            mock_post.call_args.kwargs["data"],
            {
                "grant_type": "refresh_token",
                "client_id": "handover-client",
                "client_secret": "super-secret",
                "refresh_token": "refresh-123",
                "scope": "openid profile offline_access",
            },
        )
        self.assertEqual(
            mock_post.call_args.kwargs["headers"],
            {"Content-Type": "application/x-www-form-urlencoded"},
        )

    @patch("backend.api.views.httpx.post", autospec=True)
    def test_auth_refresh_redacts_upstream_failure(self, mock_post):
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.text = '{"error":"invalid_grant","error_description":"expired refresh token"}'
        mock_post.return_value = mock_response

        with patch.multiple(
            "backend.api.views",
            OIDC_TOKEN_URL="https://issuer.example/token",
            OIDC_CLIENT_ID="handover-client",
            OIDC_CLIENT_SECRET="super-secret",
            OIDC_SCOPE="openid profile offline_access",
        ):
            response = self.client.post(
                self.refresh_url,
                data={"refresh_token": "refresh-123"},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"], ["OIDC refresh rejected."])
