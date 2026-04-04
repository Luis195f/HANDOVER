from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from backend.security.auth import Auth0User
from backend.security.scopes import CLINICAL_SCOPES, FHIR_PROFILES


class CapabilitiesViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("me-capabilities")

    @override_settings(DEBUG=True)
    def test_debug_without_authorization_fails_closed(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "auth-required")

    @override_settings(DEBUG=True)
    def test_debug_with_authorization_returns_authenticated_capabilities(self):
        claims = {
            "sub": "auth0|capabilities-user",
            "roles": ["supervisor"],
            "permissions": ["handover:write", "audit:read"],
        }

        with patch(
            "backend.api.views.Auth0JWTAuthentication.authenticate",
            return_value=(Auth0User(sub=claims["sub"], claims=claims), claims),
        ):
            response = self.client.get(self.url, HTTP_AUTHORIZATION="Bearer fake-token")

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(
            set(data.keys()),
            {"userSub", "roles", "scopes", "permissions", "scopeCatalog", "fhir"},
        )
        self.assertEqual(data["userSub"], claims["sub"])
        self.assertEqual(data["roles"], ["supervisor"])
        self.assertEqual(data["scopes"], ["audit:read", "handover:write"])
        self.assertEqual(data["scopeCatalog"], CLINICAL_SCOPES)
        self.assertEqual(
            data["permissions"],
            {
                "canWriteHandover": True,
                "canSignHandover": True,
                "canViewAudit": True,
                "canSendAuditEvents": True,
                "isAdmin": False,
            },
        )
        self.assertEqual(data["fhir"], {"version": "R4", "transaction": True, "profiles": FHIR_PROFILES})

    @override_settings(DEBUG=False)
    def test_prod_requires_authentication_without_token(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "auth-required")
