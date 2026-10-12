import os
import copy
import pathlib
import sys
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django

django.setup()
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response
from backend.api.icea_payload_mapper import _actors, _bundle_signatures, _clinical_reference_datetime, _unit_from_bundle


def test_audit_event_with_dual_signatures():
    client = APIClient()
    authenticate_api_client(client, sub="auth0|nurse-in", unit_ids=["icu-a"])
    bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"system": "urn:handover:bundle", "value": "bundle-sign-001"},
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-sign-001"},
            },
            {
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": "comp-sign-001",
                    "status": "final",
                    "subject": {"reference": "Patient/pat-sign-001"},
                    "attester": [
                        {"party": {"identifier": {"value": "nurse-out"}, "display": "Outgoing nurse"}},
                        {"party": {"identifier": {"value": "auth0|nurse-in"}, "display": "Incoming nurse"}},
                    ],
                },
            },
        ],
        "signature": [
            {
                "type": [{"code": "signature"}],
                "when": "2026-03-10T11:00:00Z",
                "who": {"identifier": {"value": "nurse-out"}},
                "data": "clinician-signature-base64",
            }
        ],
    }

    with (
        patch(
            "backend.api.views._post_transaction_to_fhir",
            autospec=True,
            return_value=build_fhir_response(status_code=200),
        ) as mock_fhir_post,
        patch("backend.api.views.httpx.post", autospec=True) as mock_audit_post,
        patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True),
    ):
        response = client.post(
            "/api/fhir/transaction",
            data=bundle,
            format="json",
            REMOTE_ADDR="10.0.0.10",
            HTTP_X_UNIT_ID="icu-a",
        )

    assert response.status_code == 200
    mock_fhir_post.assert_called_once()
    assert isinstance(mock_fhir_post.call_args.kwargs["json"]["signature"], dict)
    assert isinstance(bundle["signature"], list)
    mock_audit_post.assert_called_once()

    audit_payload = mock_audit_post.call_args.kwargs["json"]
    audit_agents = {agent["type"]["text"] for agent in audit_payload["agent"] if agent.get("type")}
    assert "outgoing-nurse-signature" in audit_agents
    assert "incoming-nurse-signature" in audit_agents

    signature_status = [
        detail["valueString"]
        for entity in audit_payload.get("entity", [])
        for detail in entity.get("detail", [])
        if detail.get("type") == "signature-status"
    ]
    assert signature_status == ["outgoingSigned;incomingSigned"]
    assert "pat-sign-001" not in str(audit_payload)


def test_clinical_signature_object_and_historical_list_preserve_unit_actor_and_date():
    signature = {
        "type": [{"system": "urn:handover:signature-type", "code": "signature"}],
        "sigFormat": "image/png", "data": "synthetic-png",
        "when": "2026-03-10T11:00:00Z",
        "who": {"identifier": {"value": "nurse-out"}},
        "onBehalfOf": {"identifier": {"value": "icu-a"}},
    }
    for node in (signature, [signature]):
        bundle = {"signature": copy.deepcopy(node)}
        original = copy.deepcopy(bundle)
        assert _unit_from_bundle(bundle, [], {}) == "icu-a"
        assert _actors(bundle, None, {})["primaryNurseId"] == "nurse-out"
        assert _clinical_reference_datetime(
            bundle=bundle, composition=None, encounter=None, window_start=None, window_end=None,
        ).isoformat() == "2026-03-10T11:00:00+00:00"
        assert bundle == original
    historical = {"signature": [signature, {**signature, "who": {"identifier": {"value": "nurse-in"}}}]}
    assert len(_bundle_signatures(historical)) == 2
    assert _actors(historical, None, {})["coSignerIds"] == ["nurse-in"]
    assert _bundle_signatures({"signature": {
        "type": [{"system": "urn:iso-astm:E1762-95:2013", "code": "1.2.840.10065.1.12.1.1"}],
        "sigFormat": "ecdsa-p256-sha256", "data": "synthetic",
    }}) == []


def test_audit_event_normalizes_reference_attester_and_keeps_legacy_clinical_pair_with_extra_professional_attesters():
    client = APIClient()
    authenticate_api_client(client, sub="auth0|nurse-in", unit_ids=["icu-a"])
    bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"system": "urn:handover:bundle", "value": "bundle-sign-002"},
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-sign-002"},
            },
            {
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": "comp-sign-002",
                    "status": "final",
                    "subject": {"reference": "Patient/pat-sign-002"},
                    "attester": [
                        {
                            "mode": "professional",
                            "party": {"identifier": {"value": "observer-1"}, "display": "Observer 1"},
                        },
                        {
                            "mode": "professional",
                            "party": {"identifier": {"value": "observer-2"}, "display": "Observer 2"},
                        },
                        {
                            "party": {"identifier": {"value": "nurse-out"}, "display": "Outgoing nurse"},
                        },
                        {
                            "party": {
                                "reference": "Practitioner/auth0%7Cnurse-in",
                                "display": "Incoming nurse",
                            },
                        },
                    ],
                },
            },
        ],
        "signature": [
            {
                "type": [{"code": "signature"}],
                "when": "2026-03-10T11:00:00Z",
                "who": {"identifier": {"value": "nurse-out"}},
                "data": "clinician-signature-base64",
            }
        ],
    }

    with (
        patch(
            "backend.api.views._post_transaction_to_fhir",
            autospec=True,
            return_value=build_fhir_response(status_code=200),
        ) as mock_fhir_post,
        patch("backend.api.views.httpx.post", autospec=True) as mock_audit_post,
        patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True),
    ):
        response = client.post(
            "/api/fhir/transaction",
            data=bundle,
            format="json",
            REMOTE_ADDR="10.0.0.11",
            HTTP_X_UNIT_ID="icu-a",
        )

    assert response.status_code == 200
    mock_fhir_post.assert_called_once()
    mock_audit_post.assert_called_once()

    audit_payload = mock_audit_post.call_args.kwargs["json"]
    attester_agents = {
        agent["type"]["text"]: agent["who"]["identifier"]["value"]
        for agent in audit_payload["agent"]
        if agent.get("type", {}).get("text") in {"outgoing-nurse-signature", "incoming-nurse-signature"}
    }
    assert attester_agents == {
        "outgoing-nurse-signature": "nurse-out",
        "incoming-nurse-signature": "auth0|nurse-in",
    }
