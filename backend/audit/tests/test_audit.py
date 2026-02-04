import os
from unittest.mock import Mock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

import django  # noqa: E402
import pytest  # noqa: E402
from django.test import Client  # noqa: E402
from rest_framework.permissions import AllowAny  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

try:
    import pytest_django  # type: ignore  # noqa: F401,E402
except Exception:  # pragma: no cover - dependency guard
    pytest.skip("pytest-django is required for audit tests", allow_module_level=True)

django.setup()

from backend.audit.models import AuditEvent  # noqa: E402
from backend.audit.service import emit_audit_event  # noqa: E402
from backend.audit.views import AuditEventsIngestView  # noqa: E402
from backend.api.views import BundleView  # noqa: E402


@pytest.mark.django_db
def test_request_id_middleware_adds_header():
    client = Client()
    response = client.get("/api/ping")
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID")


@pytest.mark.django_db
def test_audit_ingest_creates_event():
    payload = {
        "eventType": "ui_action",
        "action": "click",
        "status": "success",
        "httpStatus": 200,
        "resourceType": "Bundle",
        "resourceId": "bundle-123",
        "payloadHash": "abc",
        "payloadSize": 12,
        "requestId": "req-123",
        "client": {"deviceId": "dev-1", "appVersion": "1.0.0"},
    }

    with patch.object(AuditEventsIngestView, "permission_classes", [AllowAny]), patch.object(
        AuditEventsIngestView, "authentication_classes", []
    ):
        client = APIClient()
        response = client.post("/api/audit/events", data=payload, format="json")

    assert response.status_code == 201
    assert AuditEvent.objects.count() == 1
    event = AuditEvent.objects.first()
    assert event.event_type == "ui_action"
    assert event.request_id == "req-123"
    assert event.meta["client"] == {"deviceId": "dev-1", "appVersion": "1.0.0"}
    assert event.meta["fhir"]["resourceType"] == "AuditEvent"


@pytest.mark.django_db
def test_audit_event_stores_hash_only():
    payload = {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Patient"}}]}

    emit_audit_event(
        event_type="security_check",
        action="execute",
        status="success",
        resource_type="Bundle",
        resource_id="bundle-phi",
        payload_obj=payload,
    )

    event = AuditEvent.objects.filter(event_type="security_check").first()
    assert event is not None
    assert event.payload_hash
    assert event.payload_size
    assert "payload" not in (event.meta or {})


@pytest.mark.django_db
def test_audit_ingest_rejects_forbidden_field():
    payload = {
        "eventType": "ui_action",
        "action": "click",
        "status": "success",
        "patient": "should-not-be-here",
    }

    with patch.object(AuditEventsIngestView, "permission_classes", [AllowAny]), patch.object(
        AuditEventsIngestView, "authentication_classes", []
    ):
        client = APIClient()
        response = client.post("/api/audit/events", data=payload, format="json")

    assert response.status_code == 422


@pytest.mark.django_db
def test_audit_ingest_consent_event_is_fhir_compatible():
    payload = {
        "eventType": "consent",
        "action": "grant",
        "status": "success",
        "resourceType": "Consent",
        "resourceId": "consent-1",
    }

    with patch.object(AuditEventsIngestView, "permission_classes", [AllowAny]), patch.object(
        AuditEventsIngestView, "authentication_classes", []
    ):
        client = APIClient()
        response = client.post("/api/audit/events", data=payload, format="json")

    assert response.status_code == 201
    event = AuditEvent.objects.filter(event_type="consent").first()
    assert event is not None
    assert event.meta["fhir"]["resourceType"] == "AuditEvent"


@pytest.mark.django_db
def test_bundle_view_emits_audit_success_and_fail():
    valid_bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "identifier": {"value": "bundle-abc"},
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {
                    "resourceType": "Patient",
                    "id": "pat-test-001",
                    "name": [{"use": "official", "family": "Test", "given": ["Paciente"]}],
                    "gender": "unknown",
                },
            }
        ],
    }

    mock_resp = Mock()
    mock_resp.status_code = 201
    mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
    mock_resp.text = "ok"

    with patch.object(BundleView, "permission_classes", [AllowAny]), patch.object(
        BundleView, "authentication_classes", []
    ), patch("backend.api.views.httpx.post", return_value=mock_resp):
        client = APIClient()
        response = client.post("/api/fhir/transaction", data=valid_bundle, format="json")

    assert response.status_code in (200, 201)
    success_event = AuditEvent.objects.filter(event_type="fhir_transaction", status="success").first()
    assert success_event is not None
    assert success_event.resource_id == "bundle-abc"

    clinical_string = "Paciente"
    for field in [
        success_event.event_type,
        success_event.user_sub or "",
        success_event.scopes,
        success_event.resource_type,
        success_event.resource_id,
        success_event.action,
        success_event.status,
        success_event.ip,
        success_event.user_agent,
        success_event.request_id,
        success_event.payload_hash,
    ]:
        assert clinical_string not in str(field)
    if success_event.meta:
        assert clinical_string not in str(success_event.meta)

    invalid_bundle = {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": {}}],
    }

    with patch.object(BundleView, "permission_classes", [AllowAny]), patch.object(
        BundleView, "authentication_classes", []
    ):
        client = APIClient()
        response = client.post("/api/fhir/transaction", data=invalid_bundle, format="json")

    assert response.status_code == 422
    fail_event = AuditEvent.objects.filter(event_type="fhir_transaction", status="fail").first()
    assert fail_event is not None
