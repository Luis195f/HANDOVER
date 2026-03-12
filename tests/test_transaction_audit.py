import os
import pathlib
import sys
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django

django.setup()
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response


def test_proxy_and_auditevent_include_authenticated_actor_and_entities():
    client = APIClient()
    authenticate_api_client(client, sub="auth0|audit-user")
    bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"system": "urn:handover:bundle", "value": "bundle-audit-001"},
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-audit-001"},
            },
            {
                "request": {"method": "POST", "url": "Composition"},
                "resource": {
                    "resourceType": "Composition",
                    "id": "comp-audit-001",
                    "status": "preliminary",
                    "subject": {"reference": "Patient/pat-audit-001"},
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
        response = client.post(
            "/api/fhir/transaction",
            data=bundle,
            format="json",
            REMOTE_ADDR="192.0.2.55",
            HTTP_X_UNIT_ID="ward-a",
        )

    assert response.status_code == 200
    mock_fhir_post.assert_called_once()
    mock_audit_post.assert_called_once()

    audit_payload = mock_audit_post.call_args.kwargs["json"]
    primary_agent = audit_payload["agent"][0]
    assert primary_agent["who"]["identifier"]["value"] == "auth0|audit-user"
    assert primary_agent["network"]["address"] == "192.0.2.55"
    assert primary_agent["location"]["identifier"]["value"] == "ward-a"
    assert {entity["what"]["reference"] for entity in audit_payload["entity"]} == {
        "Patient/pat-audit-001",
        "Composition/comp-audit-001",
    }
