import os
import pathlib
import sys
from unittest.mock import Mock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django

django.setup()
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from rest_framework.test import APIClient

from backend.api.tests.icea_test_utils import authenticate_api_client


def test_remote_validation_blocks_on_error():
    client = APIClient()
    authenticate_api_client(client, unit_ids=["icu-a"])

    validation_response = Mock()
    validation_response.status_code = 200
    validation_response.json.return_value = {
        "resourceType": "OperationOutcome",
        "issue": [{"severity": "error", "diagnostics": "Invalid transaction bundle"}],
    }
    validation_response.text = '{"resourceType":"OperationOutcome"}'

    with (
        patch("backend.api.views.HANDOVER_FHIR_VALIDATION_MODE", "remote"),
        patch("backend.api.views.httpx.post", autospec=True, return_value=validation_response) as mock_validate,
    ):
        response = client.post(
            "/api/fhir/transaction",
            data={"resourceType": "Bundle", "type": "transaction", "entry": []},
            format="json",
            HTTP_X_UNIT_ID="icu-a",
        )

    assert response.status_code == 422
    assert response.json()["resourceType"] == "OperationOutcome"
    assert mock_validate.call_args.args[0].endswith("/Bundle/$validate")


def test_transaction_passthrough_preserves_operation_outcome():
    client = APIClient()
    authenticate_api_client(client, unit_ids=["icu-a"])

    tx_response = Mock()
    tx_response.status_code = 422
    tx_response.json.return_value = {
        "resourceType": "OperationOutcome",
        "issue": [
            {
                "severity": "error",
                "code": "invalid",
                "diagnostics": "Bundle.entry[4].resource.subject.reference does not resolve",
                "expression": ["Bundle.entry[4].resource.subject.reference"],
            }
        ],
    }
    tx_response.text = '{"resourceType":"OperationOutcome"}'

    with (
        patch("backend.api.views.HANDOVER_FHIR_VALIDATION_MODE", "off"),
        patch("backend.api.views._post_transaction_to_fhir", autospec=True, return_value=tx_response),
        patch("backend.api.views.persist_successful_transaction_icea_side_effects", autospec=True) as mock_side_effects,
        patch("backend.api.views._create_audit_event_for_transaction", autospec=True) as mock_audit,
    ):
        response = client.post(
            "/api/fhir/transaction",
            data={
                "resourceType": "Bundle",
                "type": "transaction",
                "entry": [{"resource": {"resourceType": "Patient", "id": "pat-1"}}],
            },
            format="json",
            HTTP_X_UNIT_ID="icu-a",
        )

    assert response.status_code == 422
    assert response.json()["resourceType"] == "OperationOutcome"
    assert response.json()["issue"][0]["expression"] == ["Bundle.entry[4].resource.subject.reference"]
    mock_side_effects.assert_not_called()
    mock_audit.assert_not_called()
