import copy
# backend/api/tests/test_security_and_validation.py
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test.utils import override_settings
from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response
from backend.audit.models import AuditEvent
from backend.signature import SignatureVerificationError


FHIR_TX_URL = "/api/fhir/transaction"

VALID_BUNDLE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "signature": [
        {
            "type": [{"code": "signature"}],
            "when": "2026-03-10T11:00:00Z",
            "onBehalfOf": {
                "reference": "Organization/icu-a",
                "identifier": {"system": "urn:handover:unit-id", "value": "icu-a"},
                "display": "icu-a",
            },
        }
    ],
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
            "onBehalfOf": {
                "reference": "Organization/icu-a",
                "identifier": {"system": "urn:handover:unit-id", "value": "icu-a"},
                "display": "icu-a",
            },
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
                "attester": [
                    {
                        "mode": "professional",
                        "time": "2026-03-10T10:55:00Z",
                        "party": {
                            "identifier": {"system": "urn:handover:user-id", "value": "nurse-1"},
                            "display": "Nurse Out",
                        },
                    },
                    {
                        "mode": "professional",
                        "time": "2026-03-10T11:00:00Z",
                        "party": {
                            "identifier": {"system": "urn:handover:user-id", "value": "auth0|test-user"},
                            "display": "Nurse In",
                        },
                    },
                ],
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


def _authorized_client(*, sub="auth0|test-user", roles=("nurse",), scopes=("fhir:transaction", "handover:write")):
    client = APIClient()
    authenticate_api_client(client, sub=sub, roles=list(roles), scopes=list(scopes), unit_ids=["icu-a"])
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
    unsigned_final.pop("signature")

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires outgoing attestation evidence."]


def test_final_bundle_without_incoming_attestation_returns_400():
    client = _authorized_client()
    unsigned_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final["entry"][1]["resource"]["attester"] = unsigned_final["entry"][1]["resource"]["attester"][:1]

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires an incoming nurse attestation."]


def test_final_bundle_with_same_actor_attesters_returns_400():
    client = _authorized_client()
    unsigned_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final["entry"][1]["resource"]["attester"][1]["party"]["identifier"]["value"] = "nurse-1"

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires distinct outgoing and incoming actors."]


def test_final_bundle_rejects_incoming_actor_mismatch():
    client = _authorized_client(sub="auth0|incoming-real")
    unsigned_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final["entry"][1]["resource"]["attester"][1]["party"]["identifier"]["value"] = "auth0|different-user"

    response = _post_fhir(client, unsigned_final)

    assert response.status_code == 403
    assert response.json()["errors"] == ["Authenticated user must match the incoming handover attestation."]


@pytest.mark.django_db
@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_final_bundle_accepts_normalized_reference_for_incoming_attestation(
    mock_fhir_post,
    _mock_audit,
    _mock_side_effects,
):
    client = _authorized_client()
    normalized_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    incoming_party = normalized_final["entry"][1]["resource"]["attester"][1]["party"]
    incoming_party.pop("identifier", None)
    incoming_party["reference"] = "Practitioner/auth0%7Ctest-user"
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, normalized_final)

    assert response.status_code == 200
    assert response.json()["type"] == "transaction-response"


@pytest.mark.django_db
@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_final_bundle_preserves_clinical_signature_object_and_both_attesters(
    mock_fhir_post, _mock_audit, _mock_side_effects,
):
    client = _authorized_client()
    bundle = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    bundle["signature"] = {
        **bundle["signature"][0],
        "type": [{"system": "urn:handover:signature-type", "code": "signature"}],
        "sigFormat": "image/png",
    }
    original = copy.deepcopy(bundle)
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, bundle)

    assert response.status_code == 200
    sent = mock_fhir_post.call_args.kwargs["json"]
    assert sent["signature"] == original["signature"]
    assert len(sent["entry"][1]["resource"]["attester"]) == 2
    assert bundle == original


@patch("backend.api.views._post_transaction_to_fhir")
def test_transport_signature_cannot_replace_clinical_evidence(mock_fhir_post):
    bundle = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    bundle["signature"] = {
        "type": [{"system": "urn:iso-astm:E1762-95:2013", "code": "1.2.840.10065.1.12.1.1"}],
        "when": "2026-03-10T11:00:00Z",
        "who": {"identifier": {"value": "nurse-1"}},
        "sigFormat": "ecdsa-p256-sha256",
        "data": "synthetic-transport",
    }
    response = _post_fhir(_authorized_client(), bundle)
    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires outgoing attestation evidence."]
    mock_fhir_post.assert_not_called()


@patch("backend.api.views._post_transaction_to_fhir")
def test_ambiguous_or_multiple_legacy_signatures_never_reach_fhir(mock_fhir_post):
    client = _authorized_client()
    mock_fhir_post.return_value = build_fhir_response(status_code=200)
    for signature in (
        [],
        [FINAL_BUNDLE_WITH_SIGNATURE["signature"][0]] * 2,
        [{**FINAL_BUNDLE_WITH_SIGNATURE["signature"][0], "sigFormat": "unknown"}],
    ):
        bundle = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
        bundle["signature"] = signature
        response = _post_fhir(client, bundle)
        assert response.status_code == 400
    mock_fhir_post.assert_not_called()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("signature", "errors"),
    [
        ([], ["Ambiguous Bundle.signature"]),
        ([FINAL_BUNDLE_WITH_SIGNATURE["signature"][0]] * 2, ["Ambiguous Bundle.signature"]),
        (["invalid"], ["Invalid Bundle.signature"]),
        ([{
            "type": [{"system": "urn:iso-astm:E1762-95:2013", "code": "1.2.840.10065.1.12.1.1"}],
            "sigFormat": "ecdsa-p256-sha256", "data": "secret-transport-signature",
        }], ["Ambiguous Bundle.signature"]),
        ({"type": [{"code": "unknown"}], "sigFormat": "image/png"}, ["Invalid Bundle.signature"]),
        ({**FINAL_BUNDLE_WITH_SIGNATURE["signature"][0], "sigFormat": "unknown"}, ["Invalid Bundle.signature"]),
        ("invalid", ["Invalid Bundle.signature"]),
    ],
)
def test_rejected_signature_shape_records_one_minimized_audit_without_side_effects(signature, errors, caplog):
    bundle = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    bundle["signature"] = copy.deepcopy(signature)
    original = copy.deepcopy(bundle)
    with (
        patch("backend.api.views._post_transaction_to_fhir") as mock_fhir_post,
        patch("backend.api.views.httpx.post") as mock_http_post,
        patch("backend.api.views.persist_successful_transaction_icea_side_effects") as mock_side_effects,
        patch("backend.api.views._persist_handover_bundle_record") as mock_persist,
        patch("backend.api.views.enqueue_icea_outbound_event_for_transaction") as mock_enqueue,
    ):
        response = _post_fhir(_authorized_client(), bundle)
    assert response.status_code == 400
    assert response.json()["errors"] == errors
    assert bundle == original
    mock_fhir_post.assert_not_called()
    mock_http_post.assert_not_called()
    mock_side_effects.assert_not_called()
    mock_persist.assert_not_called()
    mock_enqueue.assert_not_called()
    events = list(AuditEvent.objects.filter(event_type="fhir_transaction"))
    assert len(events) == 1
    event = events[0]
    assert event.user_sub == "auth0|test-user"
    assert event.status == "fail"
    assert event.http_status == 400
    assert event.meta["errorCode"] == "SIGNATURE_ERROR"
    assert event.payload_hash and event.payload_size
    recorded = json.dumps(event.meta, ensure_ascii=False)
    assert "pat-test-001" not in recorded
    assert "secret-transport-signature" not in recorded
    assert FINAL_BUNDLE_WITH_SIGNATURE["signature"][0]["data"] not in recorded
    assert "secret-transport-signature" not in caplog.text
    assert "secret-transport-signature" not in json.dumps(response.json())


@pytest.mark.django_db
def test_previously_audited_signature_rejection_remains_single_event():
    bundle = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    bundle.pop("signature")
    with patch("backend.api.views._post_transaction_to_fhir") as mock_fhir_post:
        response = _post_fhir(_authorized_client(), bundle)
    assert response.status_code == 400
    assert response.json()["errors"] == ["Final handover bundle requires outgoing attestation evidence."]
    events = list(AuditEvent.objects.filter(event_type="fhir_transaction"))
    assert len(events) == 1
    assert events[0].meta["errorCode"] == "SIGNATURE_ERROR"
    mock_fhir_post.assert_not_called()


@pytest.mark.django_db
def test_valid_legacy_signature_retains_one_success_audit():
    with (
        patch("backend.api.views._post_transaction_to_fhir", return_value=build_fhir_response(status_code=200)) as mock_fhir_post,
        patch("backend.api.views._create_audit_event_for_transaction"),
        patch("backend.api.views.persist_successful_transaction_icea_side_effects"),
    ):
        response = _post_fhir(_authorized_client(), copy.deepcopy(VALID_BUNDLE))
    assert response.status_code == 200
    mock_fhir_post.assert_called_once()
    events = list(AuditEvent.objects.filter(event_type="fhir_transaction"))
    assert len(events) == 1
    assert events[0].status == "success"
    assert "errorCode" not in events[0].meta


@pytest.mark.django_db
@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_final_bundle_accepts_extra_attesters_before_clinical_pair(
    mock_fhir_post,
    _mock_audit,
    _mock_side_effects,
):
    client = _authorized_client()
    extra_attester_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    extra_attester_final["entry"][1]["resource"]["attester"].insert(
        0,
        {
            "mode": "professional",
            "time": "2026-03-10T10:50:00Z",
            "party": {
                "identifier": {"system": "urn:handover:user-id", "value": "observer-1"},
                "display": "Observer",
            },
        },
    )
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, extra_attester_final)

    assert response.status_code == 200
    assert response.json()["type"] == "transaction-response"


@pytest.mark.django_db
@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_final_bundle_accepts_legacy_clinical_attesters_without_mode_even_with_extra_professional_attesters(
    mock_fhir_post,
    _mock_audit,
    _mock_side_effects,
):
    client = _authorized_client()
    legacy_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    legacy_final["entry"][1]["resource"]["attester"] = [
        {
            "mode": "professional",
            "time": "2026-03-10T10:45:00Z",
            "party": {
                "identifier": {"system": "urn:handover:user-id", "value": "observer-1"},
                "display": "Observer 1",
            },
        },
        {
            "mode": "professional",
            "time": "2026-03-10T10:50:00Z",
            "party": {
                "identifier": {"system": "urn:handover:user-id", "value": "observer-2"},
                "display": "Observer 2",
            },
        },
        {
            "time": "2026-03-10T10:55:00Z",
            "party": {
                "identifier": {"system": "urn:handover:user-id", "value": "nurse-1"},
                "display": "Nurse Out",
            },
        },
        {
            "time": "2026-03-10T11:00:00Z",
            "party": {
                "reference": "Practitioner/auth0%7Ctest-user",
                "display": "Nurse In",
            },
        },
    ]
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, legacy_final)

    assert response.status_code == 200
    assert response.json()["type"] == "transaction-response"


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
            "type": [{"system": "urn:iso-astm:E1762-95:2013", "code": "1.2.840.10065.1.12.1.1"}],
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


@pytest.mark.django_db
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


def test_transaction_rejects_unresolvable_unit_without_selector():
    client = _authorized_client()
    payload = copy.deepcopy(VALID_BUNDLE)
    payload.pop("signature", None)

    response = _post_fhir(client, payload)

    assert response.status_code == 400
    assert response.json()["code"] == "fhir_transaction_unit_resolution_failed"


def test_transaction_rejects_selector_that_mismatches_bundle_unit():
    client = _authorized_client()

    response = client.post(
        FHIR_TX_URL,
        data=json.dumps(VALID_BUNDLE),
        content_type="application/fhir+json",
        HTTP_X_UNIT_ID="ward-z",
    )

    assert response.status_code == 400
    assert response.json()["code"] == "fhir_transaction_unit_mismatch"


def test_transaction_rejects_bundle_unit_outside_claims():
    client = APIClient()
    authenticate_api_client(
        client,
        sub="auth0|test-user",
        roles=["nurse"],
        scopes=["fhir:transaction", "handover:write"],
        unit_ids=["icu-a"],
    )
    foreign_bundle = copy.deepcopy(VALID_BUNDLE)
    foreign_bundle["signature"][0]["onBehalfOf"]["reference"] = "Organization/ward-z"
    foreign_bundle["signature"][0]["onBehalfOf"]["identifier"]["value"] = "ward-z"
    foreign_bundle["signature"][0]["onBehalfOf"]["display"] = "ward-z"

    response = _post_fhir(client, foreign_bundle)

    assert response.status_code == 403
    assert response.json()["code"] == "fhir_transaction_forbidden_unit"


@pytest.mark.django_db
@patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True)
@patch("backend.api.views._create_audit_event_for_transaction", autospec=True)
@patch("backend.api.views._post_transaction_to_fhir")
def test_transaction_allows_admin_without_unit_claims_when_bundle_unit_is_resolved(
    mock_fhir_post,
    _mock_audit,
    _mock_side_effects,
):
    client = APIClient()
    authenticate_api_client(
        client,
        sub="auth0|admin-user",
        roles=["admin"],
        scopes=["fhir:transaction", "handover:write"],
    )
    mock_fhir_post.return_value = build_fhir_response(status_code=200)

    response = _post_fhir(client, VALID_BUNDLE)

    assert response.status_code == 200
    assert response.json()["type"] == "transaction-response"



def test_later_final_composition_still_requires_clinician_signature():
    client = _authorized_client()
    unsigned_final = copy.deepcopy(FINAL_BUNDLE_WITH_SIGNATURE)
    unsigned_final.pop('signature')
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
    assert response.json()['errors'] == ['Final handover bundle requires outgoing attestation evidence.']

