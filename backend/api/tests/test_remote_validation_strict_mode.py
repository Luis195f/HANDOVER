import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

import django
django.setup()

from django.test import RequestFactory

import backend.api.views as api_views


class _MockResp:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text

    def json(self):
        return {"resourceType": "OperationOutcome", "issue": []}


def test_remote_validate_404_permissive_in_debug(monkeypatch):
    factory = RequestFactory()
    request = factory.post("/api/fhir/transaction")

    monkeypatch.setattr(api_views, "HANDOVER_FHIR_VALIDATION_MODE", "remote", raising=False)
    monkeypatch.setattr(api_views, "HANDOVER_VALIDATE_STRICT", "auto", raising=False)
    monkeypatch.setattr(api_views, "HANDOVER_REQUIRE_RBAC_ON_FHIR", "false", raising=False)
    monkeypatch.setattr(api_views.settings, "DEBUG", True, raising=False)
    monkeypatch.setattr(api_views.httpx, "post", lambda *a, **k: _MockResp(404, "missing"), raising=True)

    response = api_views._validate_remotely(request, {"resourceType": "Patient"}, "Patient")

    assert response is None


def test_remote_validate_404_strict_in_prod(monkeypatch):
    factory = RequestFactory()
    request = factory.post("/api/fhir/transaction")

    monkeypatch.setattr(api_views, "HANDOVER_FHIR_VALIDATION_MODE", "remote", raising=False)
    monkeypatch.setattr(api_views, "HANDOVER_VALIDATE_STRICT", "auto", raising=False)
    monkeypatch.setattr(api_views, "HANDOVER_REQUIRE_RBAC_ON_FHIR", "false", raising=False)
    monkeypatch.setattr(api_views.settings, "DEBUG", False, raising=False)
    monkeypatch.setattr(api_views.httpx, "post", lambda *a, **k: _MockResp(405, "missing"), raising=True)

    response = api_views._validate_remotely(request, {"resourceType": "Patient"}, "Patient")

    assert response is not None
    assert response.status_code == 503
    assert "HANDOVER_VALIDATE_STRICT" in response.data["errors"][0]
