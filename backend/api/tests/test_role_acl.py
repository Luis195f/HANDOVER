from __future__ import annotations

from unittest.mock import Mock, patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from backend.security.auth import Auth0User


def _auth_client(claims: dict) -> APIClient:
    """
    Create an APIClient authenticated with an Auth0User built from JWT-like claims.
    Uses force_authenticate to bypass token verification in unit tests.
    """
    client = APIClient()
    user = Auth0User(sub=str(claims.get("sub", "test|user")), claims=claims)
    client.force_authenticate(user=user)
    return client


class RoleAclTests(TestCase):
    """
    Django TestCase (unittest runner compatible) to validate:
    - role+scope enforcement on FHIR transaction endpoint
    - /api/me/capabilities permissions mapping
    """

    def test_fhir_transaction_nurse_with_scope_allowed(self):
        client = _auth_client(
            {
                "sub": "auth0|nurse-1",
                "roles": ["nurse"],
                "permissions": ["fhir:transaction", "handover:write"],
            }
        )
        url = reverse("fhir-transaction")
        payload = {
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

        with patch("backend.api.views.httpx.post", autospec=True) as mock_post:
            mock_resp = Mock()
            mock_resp.status_code = 201
            mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
            mock_resp.text = '{"resourceType":"Bundle","type":"transaction-response"}'
            mock_post.return_value = mock_resp

            response = client.post(url, data=payload, format="json")

        self.assertIn(response.status_code, (200, 201))

    def test_fhir_transaction_invalid_role_forbidden(self):
        client = _auth_client(
            {
                "sub": "auth0|viewer-1",
                "roles": ["viewer"],
                "permissions": ["fhir:transaction"],
            }
        )
        url = reverse("fhir-transaction")
        payload = {"resourceType": "Bundle", "type": "transaction", "entry": []}

        with patch("backend.api.views.httpx.post", autospec=True) as mock_post:
            response = client.post(url, data=payload, format="json")

        self.assertEqual(response.status_code, 403)
        mock_post.assert_not_called()

    def test_patient_read_viewer_allowed(self):
        client = _auth_client(
            {
                "sub": "auth0|viewer-1",
                "roles": ["viewer"],
                "permissions": ["patients:read"],
            }
        )
        url = reverse("patient")

        with patch("backend.api.views.httpx.get", autospec=True) as mock_get:
            mock_resp = Mock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"resourceType": "Patient", "id": "pat-1"}
            mock_resp.text = '{"resourceType":"Patient","id":"pat-1"}'
            mock_get.return_value = mock_resp

            response = client.get(url, data={"id": "pat-1"})

        self.assertEqual(response.status_code, 200)

    def test_patient_create_viewer_forbidden(self):
        client = _auth_client(
            {
                "sub": "auth0|viewer-2",
                "roles": ["viewer"],
                "permissions": ["patients:read"],
            }
        )
        url = reverse("patient")
        payload = {"resourceType": "Patient", "id": "pat-2"}

        with patch("backend.api.views.httpx.post", autospec=True) as mock_post:
            response = client.post(url, data=payload, format="json")

        self.assertEqual(response.status_code, 403)
        mock_post.assert_not_called()

    def test_me_capabilities_for_supervisor(self):
        client = _auth_client(
            {
                "sub": "auth0|sup-1",
                "roles": ["supervisor"],
                "permissions": ["audit:read"],
                "scope": "handover:write fhir:transaction",
            }
        )
        url = reverse("me-capabilities")
        response = client.get(url)

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data.get("userSub"), "auth0|sup-1")
        perms = data.get("permissions", {})
        self.assertIs(perms.get("canSignHandover"), True)
        self.assertIs(perms.get("canViewAudit"), True)
        self.assertEqual(data.get("fhir", {}).get("version"), "R4")

    def test_me_capabilities_for_nurse(self):
        client = _auth_client(
            {
                "sub": "auth0|nurse-2",
                "roles": ["nurse"],
                "permissions": ["handover:write"],
            }
        )
        url = reverse("me-capabilities")
        response = client.get(url)

        self.assertEqual(response.status_code, 200)
        data = response.json()

        perms = data.get("permissions", {})
        self.assertIs(perms.get("canSignHandover"), False)
        self.assertIs(perms.get("canViewAudit"), False)
