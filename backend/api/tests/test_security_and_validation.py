# backend/api/tests/test_security_and_validation.py
import json
from unittest.mock import patch

from django.test.utils import override_settings
from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response


FHIR_TX_URL = "/api/fhir/transaction"

VALID_BUNDLE = {
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

INVALID_BUNDLE = {
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [{"resource": {}}],
}


def _post_fhir(api_client, payload):
    return api_client.post(
        FHIR_TX_URL,
        data=json.dumps(payload),
        content_type="application/fhir+json",
    )


def _authorized_client(*, roles=("nurse",), scopes=("fhir:transaction", "handover:write")):
    client = APIClient()
    authenticate_api_client(client, roles=list(roles), scopes=list(scopes))
    return client


def test_no_token_returns_401():
    response = _post_fhir(APIClient(), VALID_BUNDLE)

    assert response.status_code == 401


@override_settings(DEBUG=True)
def test_no_token_returns_401_even_in_debug():
    response = _post_fhir(APIClient(), VALID_BUNDLE)

    assert response.status_code == 401


def test_insufficient_scope_returns_403():
    client = _authorized_client(scopes=("fhir:transaction",))

    response = _post_fhir(client, VALID_BUNDLE)

    assert response.status_code == 403


def test_invalid_payload_returns_422_with_valid_auth():
    client = _authorized_client()

    response = _post_fhir(client, INVALID_BUNDLE)

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_BUNDLE"


@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_valid_payload_returns_200_with_valid_auth(
    mock_fhir_post,
    _mock_audit,
    _mock_side_effects,
):
    client = _authorized_client()
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, VALID_BUNDLE)

    assert response.status_code == 200
    assert response.json()["type"] == "transaction-response"
