import pytest

from backend.audit.models import AuditEvent


@pytest.mark.django_db
def test_audit_event_allows_initial_create():
    event = AuditEvent.objects.create(
        event_type="security_check",
        action="create",
        status="success",
    )

    assert event.pk is not None
    assert AuditEvent.objects.count() == 1


@pytest.mark.django_db
def test_audit_event_rejects_update_after_persist():
    event = AuditEvent.objects.create(
        event_type="security_check",
        action="create",
        status="success",
    )

    event.status = "fail"

    with pytest.raises(ValueError, match="append-only"):
        event.save()


@pytest.mark.django_db
def test_audit_event_rejects_delete_from_model_layer():
    event = AuditEvent.objects.create(
        event_type="security_check",
        action="create",
        status="success",
    )

    with pytest.raises(ValueError, match="append-only"):
        event.delete()
