import copy
# backend/api/tests/test_security_and_validation.py
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test.utils import override_settings
from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response
from backend.signature import SignatureVerificationError


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

FINAL_BUNDLE_WITH_SIGNATURE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "signature": [
        {
            "type": [{"code": "signature"}],
            "when": "2026-03-10T11:00:00Z",
            "who": {"identifier": {"value": "nurse-1"}},
            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
        }
    ],
    "entry": [
        {
            "request": {"method": "POST", "url": "Patient"},
            "resource": {
                "resourceType": "Patient",
                "id": "pat-test-001",
            },
        },
        {
            "request": {"method": "POST", "url": "Composition"},
            "resource": {
                "resourceType": "Composition",
                "id": "comp-test-001",
                "status": "final",
                "author": [{"reference": "Practitioner/nurse-1"}],
                "subject": {"reference": "Patient/pat-test-001"},
                "type": {"text": "handover"},
                "date": "2026-03-10T11:00:00Z",
                "title": "Clinical handover summary",
            },
        },
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


def test_final_bundle_without_clinician_signature_returns_400():
    client = _authorized_client()
    unsigned_final = dict(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final["signature"] = []

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires an outgoing clinical signature."]


@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views.verify_bundle_signature", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_invalid_transport_signature_returns_400(
    mock_fhir_post,
    mock_verify_signature,
    _mock_audit,
    _mock_side_effects,
):
    client = _authorized_client()
    transport_signed = dict(VALID_BUNDLE)
    transport_signed["signature"] = {
        "when": "2026-03-10T11:00:00Z",
        "data": "invalid-signature",
        "sigFormat": "ecdsa-p256-sha256",
    }
    mock_verify_signature.side_effect = SignatureVerificationError("bad signature")

    with patch("backend.api.views.SIGNATURE_SETTINGS", SimpleNamespace(enabled=True)):
        response = _post_fhir(client, transport_signed)

    assert response.status_code == 400
    assert response.json()["errors"] == ["Invalid signature"]
    mock_fhir_post.assert_not_called()


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



def test_later_final_composition_still_requires_clinician_signature():
    client = _authorized_client()
    unsigned_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final['signature'] = []
    unsigned_final['entry'].insert(
        1,
        {
            'request': {'method': 'POST', 'url': 'Composition'},
            'resource': {
                'resourceType': 'Composition',
                'id': 'comp-test-preliminary',
                'status': 'preliminary',
                'author': [{'reference': 'Practitioner/nurse-1'}],
                'subject': {'reference': 'Patient/pat-test-001'},
                'type': {'text': 'handover'},
                'date': '2026-03-10T10:50:00Z',
                'title': 'Draft handover summary',
            },
        },
    )

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 400
    assert response.json()['errors'] == ['Final handover bundle requires an outgoing clinical signature.']

