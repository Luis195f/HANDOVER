import os
import pathlib
import sys
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django

django.setup()
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from rest_framework.test import APIClient

from backend.api.audit_pseudonymization import build_audit_patient_key
from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response


def test_transaction_resources_contract_and_audit():
    client = APIClient()
    authenticate_api_client(client)
    sample_bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"system": "urn:handover:bundle", "value": "bundle-contract-001"},
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-contract-001"},
            },
            {
                "request": {"method": "POST", "url": "Encounter"},
                "resource": {"resourceType": "Encounter", "id": "enc-contract-001"},
            },
            {
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": "comp-contract-001",
                    "status": "preliminary",
                    "subject": {"reference": "Patient/pat-contract-001"},
                    "encounter": {"reference": "Encounter/enc-contract-001"},
                },
            },
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
        response = client.post("/api/fhir/transaction", data=sample_bundle, format="json")

    assert response.status_code == 200
    tx_bundle = mock_fhir_post.call_args.kwargs["json"]
    resource_types = [entry["resource"]["resourceType"] for entry in tx_bundle["entry"]]
    assert resource_types == ["Patient", "Encounter", "Composition"]
    assert tx_bundle["meta"]["tag"]

    audit_payload = mock_audit_post.call_args.kwargs["json"]
    assert audit_payload["resourceType"] == "AuditEvent"
    patient_entities = [
        entity["what"]["identifier"]["value"]
        for entity in audit_payload["entity"]
        if entity.get("what", {}).get("identifier", {}).get("system") == "urn:handover:audit:patient-key"
    ]
    assert patient_entities == [build_audit_patient_key("pat-contract-001")]
    assert {entity["what"]["reference"] for entity in audit_payload["entity"] if entity.get("what", {}).get("reference")} == {
        "Composition/comp-contract-001",
    }
    assert "pat-contract-001" not in str(audit_payload)
