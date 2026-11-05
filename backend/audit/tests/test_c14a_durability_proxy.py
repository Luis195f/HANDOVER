"""C14A audit persistence and trusted network attribution (synthetic data only)."""

from datetime import timedelta
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.db import OperationalError, transaction
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.test import APIClient

from backend.audit.middleware import AuditRequestMiddleware
from backend.audit.models import AuditEvent
from backend.audit.views import AuditEventsIngestView
from backend.api.clinical_storage import decrypt_bundle_document
from backend.api.models import ExceptionHandoverShift
from backend.api.views_exception_handover import ExceptionShiftOperationView
from backend.security.auth import Auth0User


@pytest.mark.django_db
def test_ingest_reports_storage_failure_instead_of_false_success():
    payload = {"eventType": "synthetic", "action": "create", "status": "success"}
    with patch.object(AuditEventsIngestView, "permission_classes", [AllowAny]), patch.object(
        AuditEventsIngestView, "authentication_classes", []
    ), patch.object(AuditEvent.objects, "create", side_effect=OSError("synthetic failure")):
        response = APIClient().post("/api/audit/events", payload, format="json")
    assert response.status_code == 503
    assert response.data == {"code": "audit_unavailable"}
    assert AuditEvent.objects.count() == 0


@pytest.mark.django_db
def test_ingest_fails_atomically_when_second_audit_write_fails():
    payload = [
        {"eventType": "synthetic", "action": "create", "status": "success"},
        {"eventType": "synthetic", "action": "update", "status": "success"},
    ]
    create = AuditEvent.objects.create
    calls = 0

    def fail_second(**fields):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("synthetic audit storage failure")
        return create(**fields)

    with patch.object(AuditEventsIngestView, "permission_classes", [AllowAny]), patch.object(
        AuditEventsIngestView, "authentication_classes", []
    ), patch.object(AuditEvent.objects, "create", side_effect=fail_second):
        response = APIClient().post("/api/audit/events", payload, format="json")
    assert response.status_code == 503
    assert response.data == {"code": "audit_unavailable"}
    assert AuditEvent.objects.count() == 0


@pytest.mark.django_db
def test_ordinary_queryset_modification_is_denied_but_retention_prunes_expired():
    old = AuditEvent.objects.create(event_type="synthetic", action="create", status="success",
                                    timestamp=timezone.now() - timedelta(days=200))
    recent = AuditEvent.objects.create(event_type="synthetic", action="create", status="success")
    with pytest.raises(ValueError, match="append-only"):
        AuditEvent.objects.filter(pk=recent.pk).update(status="fail")
    with pytest.raises(ValueError, match="append-only"):
        AuditEvent.objects.filter(pk=recent.pk).delete()
    with pytest.raises(ValueError, match="append-only"):
        with transaction.atomic():
            AuditEvent.objects.bulk_update([recent], ["status"])
    call_command("prune_audit", days=180)
    assert not AuditEvent.objects.filter(pk=old.pk).exists()
    assert AuditEvent.objects.get(pk=recent.pk).status == "success"


@pytest.mark.parametrize("remote,header,expected", [
    ("198.51.100.7", "203.0.113.9", "198.51.100.7"),
    ("10.0.0.2", "203.0.113.9, 198.51.100.7", "198.51.100.7"),
    ("10.0.0.2", "2001:db8::4, 10.0.0.3", "2001:db8::4"),
    ("10.0.0.2", "2001:db8::4, 10.0.0.3, 10.0.0.4", "2001:db8::4"),
    ("10.0.0.2", "garbage, 10.0.0.3", "10.0.0.2"),
    ("10.0.0.2", "203.0.113.9, ", "10.0.0.2"),
])
def test_proxy_chain_uses_first_untrusted_hop_and_rejects_invalid_headers(monkeypatch, remote, header, expected):
    monkeypatch.setenv("AUDIT_TRUSTED_PROXY_CIDRS", "10.0.0.0/24")
    request = SimpleNamespace(META={"REMOTE_ADDR": remote, "HTTP_X_FORWARDED_FOR": header})
    assert AuditRequestMiddleware._get_client_ip(request) == expected


@pytest.mark.django_db
def test_audit_event_keeps_authenticated_actor_and_verified_network_origin(monkeypatch):
    monkeypatch.delenv("AUDIT_TRUSTED_PROXY_CIDRS", raising=False)
    claims = {"sub": "auth0|synthetic", "roles": ["nurse"], "permissions": ["audit:write"],
              "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub="auth0|synthetic", claims=claims), token=claims)
    response = client.post("/api/audit/events", {"eventType": "synthetic", "action": "create",
                                            "status": "success"}, format="json",
                           REMOTE_ADDR="198.51.100.7", HTTP_X_FORWARDED_FOR="203.0.113.9")
    assert response.status_code == 201
    event = AuditEvent.objects.get(event_type="synthetic")
    assert (event.user_sub, event.ip, event.scopes) == (
        "auth0|synthetic", "198.51.100.7", "audit:write")


@pytest.mark.django_db
@override_settings(HANDOVER_DEPLOYMENT_MODE="test")
def test_c12_operation_receipt_and_writer_audit_are_durable_in_same_revision():
    claims = {"sub": "auth0|creator", "roles": ["nurse"],
              "permissions": ["patients:read", "handover:write"], "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub="auth0|creator", claims=claims), token=claims)
    with patch.dict(os.environ, {"HANDOVER_EXCEPTION_TEST_RUNTIME": "true"}):
        created = client.post(reverse("exception-shifts"), {
            "unitId": "icu-a", "periodStart": "2026-10-28T08:00:00Z",
            "periodEnd": "2026-10-28T16:00:00Z", "description": "Synthetic shift",
            "operationId": "e58813bf-26bd-4e14-9492-e66ef9f9e81a",
        }, format="json")
        assert created.status_code == 201
        shift_id = created.data["id"]
        state = client.get(reverse("exception-shift", args=[shift_id])).data["state"]
        state["interactionCounts"]["synthetic"] = 1
        operation_id = "97b06123-4cd6-471d-a574-354113ca08be"
        writer_claims = {**claims, "sub": "auth0|writer"}
        writer = APIClient()
        writer.force_authenticate(user=Auth0User(sub="auth0|writer", claims=writer_claims),
                                  token=writer_claims)
        confirmed = writer.post(reverse("exception-shift-operation", args=[shift_id, operation_id]),
                                {"state": state, "expectedRevision": 0}, format="json")
        assert confirmed.status_code == 201
    record = ExceptionHandoverShift.objects.get(id=shift_id)
    stored = decrypt_bundle_document(record.state_json, encryption_metadata=record.encryption_metadata)
    assert (record.creator_sub, record.unit_id, record.revision) == ("auth0|creator", "icu-a", 1)
    assert stored["_operations"][operation_id] == confirmed.data
    assert stored["interactionCounts"]["synthetic"] == 1
    audit = AuditEvent.objects.get(event_type="exception_handover_operation")
    assert (audit.user_sub, audit.meta["unitId"], audit.resource_id) == (
        "auth0|writer", "icu-a", shift_id)
    assert audit.meta["operationId"] == operation_id
    assert audit.meta["revision"] == 1
    assert AuditEvent.objects.get(event_type="exception_handover_shift").user_sub == "auth0|creator"

    with patch.dict(os.environ, {"HANDOVER_EXCEPTION_TEST_RUNTIME": "true"}):
        replay = client.post(reverse("exception-shift-operation", args=[shift_id, operation_id]),
                             {"state": state, "expectedRevision": 0}, format="json")
        assert replay.status_code == 200
        altered = {**state, "interactionCounts": {"synthetic": 2}}
        conflict = writer.post(reverse("exception-shift-operation", args=[shift_id, operation_id]),
                               {"state": altered, "expectedRevision": 0}, format="json")
        assert conflict.status_code == 409
    assert AuditEvent.objects.filter(event_type="exception_handover_operation").count() == 1
    assert AuditEvent.objects.get(event_type="exception_handover_operation").user_sub == "auth0|writer"


@pytest.mark.django_db
@override_settings(HANDOVER_DEPLOYMENT_MODE="test")
def test_c12_creation_audit_failure_rolls_back_shift():
    claims = {"sub": "auth0|creator", "roles": ["nurse"],
              "permissions": ["patients:read", "handover:write"], "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub="auth0|creator", claims=claims), token=claims)
    with patch.dict(os.environ, {"HANDOVER_EXCEPTION_TEST_RUNTIME": "true"}), patch.object(
        AuditEvent.objects, "create", side_effect=OSError("synthetic audit failure")
    ):
        response = client.post(reverse("exception-shifts"), {
            "unitId": "icu-a", "periodStart": "2026-10-28T08:00:00Z",
            "periodEnd": "2026-10-28T16:00:00Z", "description": "Synthetic shift",
            "operationId": "e58813bf-26bd-4e14-9492-e66ef9f9e81a",
        }, format="json")
    assert response.status_code == 503
    assert response.data == {"code": "audit_unavailable"}
    assert ExceptionHandoverShift.objects.count() == 0
    assert AuditEvent.objects.count() == 0


@pytest.mark.django_db
@override_settings(HANDOVER_DEPLOYMENT_MODE="test")
def test_c12_operation_audit_failure_rolls_back_and_retry_writes_once():
    claims = {"sub": "auth0|creator", "roles": ["nurse"],
              "permissions": ["patients:read", "handover:write"], "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub="auth0|creator", claims=claims), token=claims)
    with patch.dict(os.environ, {"HANDOVER_EXCEPTION_TEST_RUNTIME": "true"}):
        shift_id = client.post(reverse("exception-shifts"), {
            "unitId": "icu-a", "periodStart": "2026-10-28T08:00:00Z",
            "periodEnd": "2026-10-28T16:00:00Z", "description": "Synthetic shift",
            "operationId": "e58813bf-26bd-4e14-9492-e66ef9f9e81a",
        }, format="json").data["id"]
        state = client.get(reverse("exception-shift", args=[shift_id])).data["state"]
        state["interactionCounts"]["synthetic"] = 1
        operation_id = "97b06123-4cd6-471d-a574-354113ca08be"
        route = reverse("exception-shift-operation", args=[shift_id, operation_id])
        body = {"state": state, "expectedRevision": 0}
        with patch.object(AuditEvent.objects, "create", side_effect=OSError("synthetic audit failure")):
            failed = client.post(route, body, format="json")
        assert failed.status_code == 503
        assert failed.data == {"code": "audit_unavailable"}
        record = ExceptionHandoverShift.objects.get(id=shift_id)
        stored = decrypt_bundle_document(record.state_json, encryption_metadata=record.encryption_metadata)
        assert record.revision == 0
        assert stored["_operations"] == {}
        assert stored["interactionCounts"] == {}
        assert not AuditEvent.objects.filter(event_type="exception_handover_operation").exists()
        confirmed = client.post(route, body, format="json")
        assert confirmed.status_code == 201
        assert client.post(route, body, format="json").status_code == 200
    assert ExceptionHandoverShift.objects.get(id=shift_id).revision == 1
    assert AuditEvent.objects.filter(event_type="exception_handover_operation").count() == 1


@pytest.mark.django_db
@override_settings(HANDOVER_DEPLOYMENT_MODE="test")
def test_c12_retries_transient_sqlite_lock_on_initial_record_read():
    claims = {"sub": "auth0|creator", "roles": ["nurse"],
              "permissions": ["patients:read", "handover:write"], "unitIds": ["icu-a"]}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub="auth0|creator", claims=claims), token=claims)
    with patch.dict(os.environ, {"HANDOVER_EXCEPTION_TEST_RUNTIME": "true"}):
        shift_id = client.post(reverse("exception-shifts"), {
            "unitId": "icu-a", "periodStart": "2026-10-28T08:00:00Z",
            "periodEnd": "2026-10-28T16:00:00Z", "description": "Synthetic shift",
            "operationId": "e58813bf-26bd-4e14-9492-e66ef9f9e81a",
        }, format="json").data["id"]
        state = client.get(reverse("exception-shift", args=[shift_id])).data["state"]
        state["interactionCounts"]["synthetic"] = 1
        original = ExceptionShiftOperationView.record
        calls = 0

        def locked_once(request, record_id):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OperationalError("database table is locked: api_exceptionhandovershift")
            return original(request, record_id)

        with patch.object(ExceptionShiftOperationView, "record", side_effect=locked_once), patch(
            "backend.api.views_exception_handover.time.sleep"
        ):
            response = client.post(reverse("exception-shift-operation", args=[shift_id,
                "97b06123-4cd6-471d-a574-354113ca08be"]),
                {"state": state, "expectedRevision": 0}, format="json")
    assert response.status_code == 201
    assert calls == 2
    assert ExceptionHandoverShift.objects.get(id=shift_id).revision == 1


def test_invalid_proxy_configuration_and_invalid_peer_fail_closed(monkeypatch):
    monkeypatch.setenv("AUDIT_TRUSTED_PROXY_CIDRS", "not-a-network")
    request = SimpleNamespace(META={"REMOTE_ADDR": "198.51.100.7",
                                    "HTTP_X_FORWARDED_FOR": "203.0.113.9"})
    assert AuditRequestMiddleware._get_client_ip(request) == "198.51.100.7"
    request.META["REMOTE_ADDR"] = "invalid"
    assert AuditRequestMiddleware._get_client_ip(request) == ""
