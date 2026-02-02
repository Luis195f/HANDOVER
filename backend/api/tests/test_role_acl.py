from unittest.mock import Mock, patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from backend.security.auth import Auth0User


def _auth_client(claims: dict) -> APIClient:
    client = APIClient()
    user = Auth0User(sub=str(claims.get("sub", "test|user")), claims=claims)
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_fhir_transaction_nurse_with_scope_allowed():
    client = _auth_client(
        {
            "sub": "auth0|nurse-1",
            "roles": ["nurse"],
            "permissions": ["handover:write"],
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

    assert response.status_code in (200, 201)


@pytest.mark.django_db
def test_fhir_transaction_invalid_role_forbidden():
    client = _auth_client(
        {
            "sub": "auth0|viewer-1",
            "roles": ["viewer"],
            "permissions": ["handover:write"],
        }
    )
    url = reverse("fhir-transaction")
    payload = {"resourceType": "Bundle", "type": "transaction", "entry": []}

    with patch("backend.api.views.httpx.post", autospec=True) as mock_post:
        response = client.post(url, data=payload, format="json")

    assert response.status_code == 403
    mock_post.assert_not_called()


@pytest.mark.django_db
def test_me_capabilities_for_supervisor():
    client = _auth_client(
        {
            "sub": "auth0|sup-1",
            "roles": ["supervisor"],
            "permissions": ["handover:audit"],
            "scope": "handover:write",
        }
    )
    url = reverse("me-capabilities")
    response = client.get(url)

    assert response.status_code == 200
    payload = response.json()
    assert payload["userSub"] == "auth0|sup-1"
    assert payload["permissions"]["canSignHandover"] is True
    assert payload["permissions"]["canViewAudit"] is True


@pytest.mark.django_db
def test_me_capabilities_for_nurse():
    client = _auth_client(
        {
            "sub": "auth0|nurse-2",
            "roles": ["nurse"],
            "permissions": ["handover:write"],
        }
    )
    url = reverse("me-capabilities")
    response = client.get(url)

    assert response.status_code == 200
    payload = response.json()
    assert payload["permissions"]["canSignHandover"] is False
    assert payload["permissions"]["canViewAudit"] is False
