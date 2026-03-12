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
    authenticate_api_client(client)

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
        )

    assert response.status_code == 422
    assert response.json()["resourceType"] == "OperationOutcome"
    assert mock_validate.call_args.args[0].endswith("/Bundle/$validate")
