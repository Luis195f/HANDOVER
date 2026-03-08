import types
from unittest.mock import Mock


def build_icea_bundle(*, bundle_id: str = "bundle-tx-001", patient_id: str = "pat-001", unit_id: str = "icu-a"):
    encounter_id = bundle_id.replace("bundle", "enc")
    composition_id = bundle_id.replace("bundle", "comp")
    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"system": "urn:handover-pro:tx", "value": bundle_id},
        "signature": [
            {
                "type": [{"code": "signature"}],
                "when": "2026-03-07T11:00:00Z",
                "onBehalfOf": {
                    "reference": f"Organization/{unit_id}",
                    "identifier": {"system": "urn:handover:unit-id", "value": unit_id},
                    "display": unit_id,
                },
            }
        ],
        "entry": [
            {
                "fullUrl": f"urn:uuid:{patient_id}",
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": patient_id},
            },
            {
                "fullUrl": f"urn:uuid:{encounter_id}",
                "request": {"method": "POST", "url": "Encounter"},
                "resource": {"resourceType": "Encounter", "id": encounter_id},
            },
            {
                "fullUrl": f"urn:uuid:{composition_id}",
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": composition_id,
                    "subject": {"reference": f"urn:uuid:{patient_id}"},
                    "encounter": {"reference": f"urn:uuid:{encounter_id}"},
                },
            },
        ],
    }


def build_authenticated_api_user(*, sub: str, roles: list[str], scopes: list[str]):
    claims = {
        "sub": sub,
        "permissions": scopes,
        "scope": " ".join(scopes),
        "roles": roles,
    }
    return types.SimpleNamespace(
        is_authenticated=True,
        claims=claims,
        sub=sub,
        username=sub,
    ), claims


def build_fhir_response(status_code: int = 201):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
    response.text = '{"resourceType":"Bundle","type":"transaction-response"}'
    response.headers = {"Content-Type": "application/fhir+json"}
    return response
