import json

import httpx
import respx
from fastapi.testclient import TestClient

from main import FHIR_BASE, app

client = TestClient(app)


def build_bundle_with_attesters(attesters):
    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": [
            {
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": "comp-1",
                    "status": "final",
                    "type": {"text": "handover"},
                    "subject": {"reference": "Patient/pat-1"},
                    "date": "2024-01-01T00:00:00Z",
                    "author": [{"reference": "Practitioner/nurse-1"}],
                    "title": "Handover",
                    "attester": attesters,
                },
            }
        ],
    }


def test_audit_event_without_attesters():
    bundle = build_bundle_with_attesters([])
    with respx.mock(base_url=FHIR_BASE) as mock:
        mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )
        ae_route = mock.post("/AuditEvent").mock(
            return_value=httpx.Response(201, json={"resourceType": "AuditEvent", "id": "ae-1"})
        )

        r = client.post("/fhir/transaction", json=bundle, headers={"X-User-Id": "nurse-1"})
        assert r.status_code == 200
        req = ae_route.calls[0].request
        ae_body = json.loads(req.content.decode("utf-8"))

        assert len(ae_body["agent"]) == 1
        texts = [agent.get("type", {}).get("text") for agent in ae_body["agent"]]
        assert "outgoing-nurse-signature" not in texts
        assert "incoming-nurse-signature" not in texts


def test_audit_event_with_dual_signatures():
    attesters = [
        {
            "mode": "professional",
            "time": "2024-01-01T00:00:00Z",
            "party": {"identifier": {"system": "urn:handover:user-id", "value": "nurse-out"}, "display": "Nurse Out"},
        },
        {
            "mode": "professional",
            "time": "2024-01-01T01:00:00Z",
            "party": {"identifier": {"system": "urn:handover:user-id", "value": "nurse-in"}, "display": "Nurse In"},
        },
    ]
    bundle = build_bundle_with_attesters(attesters)
    with respx.mock(base_url=FHIR_BASE) as mock:
        mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )
        ae_route = mock.post("/AuditEvent").mock(
            return_value=httpx.Response(201, json={"resourceType": "AuditEvent", "id": "ae-2"})
        )

        r = client.post("/fhir/transaction", json=bundle, headers={"X-User-Id": "nurse-1"})
        assert r.status_code == 200
        req = ae_route.calls[0].request
        ae_body = json.loads(req.content.decode("utf-8"))

        texts = [agent.get("type", {}).get("text") for agent in ae_body["agent"]]
        assert "outgoing-nurse-signature" in texts
        assert "incoming-nurse-signature" in texts

        details = [entity.get("detail", []) for entity in ae_body.get("entity", [])]
        flat_details = [item for sub in details for item in sub]
        status_values = [detail.get("valueString") for detail in flat_details if detail.get("type") == "signature-status"]
        assert "outgoingSigned;incomingSigned" in status_values
