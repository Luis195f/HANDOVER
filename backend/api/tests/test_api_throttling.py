import pytest
from django.core.cache import cache
from django.test import override_settings
from django.urls import resolve
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from backend.security.auth import Auth0User


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def client_for(sub):
    claims = {"sub": sub, "roles": ["nurse"],
              "permissions": ["handover:write", "patients:read", "fhir:transaction"],
              "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=sub, claims=claims), token=claims)
    return client


@pytest.mark.parametrize("paths", [
    ["auth/refresh", "auth/refresh/"],
    ["ai/transcribe", "ai/transcribe/", "upload/audio-to-fhir", "upload/audio-to-fhir/"],
    ["ai/summarize-sbar", "ai/summarize-sbar/", "ai/refine-sbar", "ai/refine-sbar/",
     "ai/suggest-interventions", "ai/suggest-interventions/", "ai/clinical-decision", "ai/clinical-decision/"],
    ["fhir/patient", "patients", "patients/", "fhir/medicationstatement", "fhir/transaction",
     "fhir/transaction/", "metrics/handover-time", "metrics/handover-time/", "audit", "audit/",
     "audit/events", "audit/events/", "icea/actions/normalize", "icea/actions/normalize/",
     "icea/bridge/retry/1", "icea/bridge/retry/1/", "exception-shifts",
     "exception-shifts/00000000-0000-4000-8000-000000000001/operations/00000000-0000-4000-8000-000000000002"],
])
def test_operation_aliases_share_throttle_class(paths):
    classes = [resolve("/api/" + path).func.initkwargs.get("throttle_classes") for path in paths]
    assert classes[0] and all(value == classes[0] for value in classes)


@pytest.mark.parametrize("framework", [
    {"DEFAULT_AUTHENTICATION_CLASSES": [], "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"]},
    {"DEFAULT_AUTHENTICATION_CLASSES": ["backend.security.auth.Auth0JWTAuthentication"],
     "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"]},
])
def test_authenticated_quota_is_per_sub_and_scope_with_retry_after(monkeypatch, framework):
    from backend.api.throttles import AISuggestionThrottle, SensitiveWriteThrottle
    monkeypatch.setattr(AISuggestionThrottle, "rate", "2/min")
    monkeypatch.setattr(SensitiveWriteThrottle, "rate", "2/min")
    first = client_for("auth0|first")
    second = client_for("auth0|second")
    with override_settings(REST_FRAMEWORK={**framework,
                                            "EXCEPTION_HANDLER": "backend.security.drf_exceptions.handover_exception_handler"}):
        for path in ("/api/ai/clinical-decision", "/api/ai/clinical-decision/"):
            assert first.post(path, {}, format="json").status_code != 429
        blocked = first.post("/api/ai/clinical-decision", {}, format="json")
        assert blocked.status_code == 429
        assert blocked.data["code"] == "throttled"
        assert int(blocked["Retry-After"]) > 0
        assert second.post("/api/ai/clinical-decision", {}, format="json").status_code != 429
        assert first.post("/api/fhir/transaction", {}, format="json").status_code != 429


def test_quota_recovers_after_window(monkeypatch):
    from backend.api.throttles import AISuggestionThrottle
    clock = [1000.0]
    monkeypatch.setattr(AISuggestionThrottle, "rate", "1/min")
    monkeypatch.setattr(AISuggestionThrottle, "timer", staticmethod(lambda: clock[0]))
    client = client_for("auth0|window")
    assert client.post("/api/ai/clinical-decision", {}, format="json").status_code != 429
    assert client.post("/api/ai/clinical-decision", {}, format="json").status_code == 429
    clock[0] += 61
    assert client.post("/api/ai/clinical-decision", {}, format="json").status_code != 429


def test_refresh_uses_trusted_network_origin_not_spoofed_xff(monkeypatch):
    from backend.api.throttles import RefreshThrottle
    monkeypatch.setattr(RefreshThrottle, "rate", "2/min")
    monkeypatch.delenv("AUDIT_TRUSTED_PROXY_CIDRS", raising=False)
    client = APIClient()
    for path, xff in (("/api/auth/refresh", "203.0.113.1"),
                      ("/api/auth/refresh/", "203.0.113.2")):
        assert client.post(path, {}, format="json", REMOTE_ADDR="198.51.100.7",
                           HTTP_X_FORWARDED_FOR=xff).status_code != 429
    blocked = client.post("/api/auth/refresh", {}, format="json", REMOTE_ADDR="198.51.100.7",
                          HTTP_X_FORWARDED_FOR="203.0.113.3")
    assert blocked.status_code == 429
    assert blocked.data["code"] == "throttled"
    assert client.post("/api/auth/refresh", {}, format="json", REMOTE_ADDR="198.51.100.8").status_code != 429


@pytest.mark.parametrize("path", ["/api/ai/transcribe", "/api/upload/audio-to-fhir"])
def test_oversized_request_is_rejected_before_multipart_parse(monkeypatch, path):
    from unittest.mock import patch
    from rest_framework.parsers import MultiPartParser
    from backend.api.views_ai import HANDOVER_MAX_AUDIO_BYTES
    factory = APIRequestFactory()
    request = factory.post(path, {"file": b"synthetic"}, format="multipart")
    request.META["CONTENT_LENGTH"] = str(HANDOVER_MAX_AUDIO_BYTES + 65537)
    claims = {"sub": "auth0|audio", "roles": ["nurse"],
              "permissions": ["handover:write", "patients:read"], "unitIds": ["icu-a"]}
    force_authenticate(request, user=Auth0User(sub=claims["sub"], claims=claims), token=claims)
    with patch.object(MultiPartParser, "parse", side_effect=AssertionError("parsed too early")) as parser:
        response = resolve(path).func(request)
    assert response.status_code == 413
    assert response.data["code"] == "audio_request_too_large"
    parser.assert_not_called()
