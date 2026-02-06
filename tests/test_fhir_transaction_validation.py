import httpx
import pytest
from fastapi.testclient import TestClient
import main

try:
    import respx  # type: ignore
except Exception:  # pragma: no cover - dependency guard
    respx = None

client = TestClient(main.app)


if respx is None:  # pragma: no cover - dependency guard
    pytest.skip("respx is required for these tests", allow_module_level=True)


def build_bundle():
    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-1"},
            }
        ],
    }


def test_validation_mode_off_does_not_block(monkeypatch):
    """Should skip remote validation when mode=off."""
    monkeypatch.setattr(main, "HANDOVER_FHIR_VALIDATION_MODE", "off")

    with respx.mock(base_url=main.FHIR_BASE, assert_all_called=False) as mock:
        validate_route = mock.post("/Bundle/$validate").mock(
            return_value=httpx.Response(200, json={"resourceType": "OperationOutcome", "issue": []})
        )
        tx_route = mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )

        response = client.post(
    "/fhir/transaction",
    json=build_bundle(),
    headers={"Authorization": "Bearer test-access-token"},
)

        assert response.status_code == 200
        assert tx_route.called
        assert not validate_route.called


def test_remote_validation_allows_success(monkeypatch):
    """Should allow successful remote validation."""
    monkeypatch.setattr(main, "HANDOVER_FHIR_VALIDATION_MODE", "remote")

    with respx.mock(base_url=main.FHIR_BASE, assert_all_called=False) as mock:
        mock.post("/Bundle/$validate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resourceType": "OperationOutcome",
                    "issue": [
                        {"severity": "information", "details": {"text": "Valid"}},
                    ],
                },
            )
        )
        tx_route = mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )

        response = client.post(
    "/fhir/transaction",
    json=build_bundle(),
    headers={"Authorization": "Bearer test-access-token"},
)

        assert response.status_code == 200
        assert tx_route.called


def test_remote_validation_blocks_on_error(monkeypatch):
    """Should block and return 422 on remote validation error."""
    monkeypatch.setattr(main, "HANDOVER_FHIR_VALIDATION_MODE", "remote")

    with respx.mock(base_url=main.FHIR_BASE, assert_all_called=False) as mock:
        mock.post("/Bundle/$validate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resourceType": "OperationOutcome",
                    "issue": [
                        {"severity": "error", "details": {"text": "Profile XYZ not satisfied"}},
                    ],
                },
            )
        )
        tx_route = mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )

        response = client.post(
    "/fhir/transaction",
    json=build_bundle(),
    headers={"Authorization": "Bearer test-access-token"},
)

        assert response.status_code == 422
        assert "Profile XYZ" in response.json().get("detail", {}).get("errors", [""])[0]
        assert not tx_route.called


def test_remote_validation_not_supported_allows_flow(monkeypatch):
    """Should continue when remote validation is not supported (HTTP 404)."""
    monkeypatch.setattr(main, "HANDOVER_FHIR_VALIDATION_MODE", "remote")

    with respx.mock(base_url=main.FHIR_BASE, assert_all_called=False) as mock:
        mock.post("/Bundle/$validate").mock(return_value=httpx.Response(404, text="Not supported"))
        tx_route = mock.post("/").mock(
            return_value=httpx.Response(
                200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []}
            )
        )

        response = client.post(
    "/fhir/transaction",
    json=build_bundle(),
    headers={"Authorization": "Bearer test-access-token"},
)

        assert response.status_code == 200
        assert tx_route.called
