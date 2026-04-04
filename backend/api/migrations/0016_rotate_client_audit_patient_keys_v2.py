import hashlib
import hmac
import re

from django.conf import settings
from django.db import migrations


AUDIT_PATIENT_KEY_PREFIX = "ptk2_"
AUDIT_PATIENT_KEY_HASH_LENGTH = 24
AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk2_[0-9a-f]{24}$")
LEGACY_AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk_[0-9a-f]{24}$")
AUDIT_PATIENT_KEY_NAMESPACE = "handover.audit.patient.v2:"


def _normalize_patient_identifier(value: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(candidate):
        return candidate
    if LEGACY_AUDIT_PATIENT_KEY_PATTERN.fullmatch(candidate):
        return candidate
    if candidate.startswith("Patient/"):
        _, _, suffix = candidate.partition("/")
        normalized = suffix.strip()
        return normalized or candidate
    return candidate


def _build_patient_key(value: str) -> str:
    normalized = _normalize_patient_identifier(value)
    if not normalized:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(normalized):
        return normalized
    secret = (getattr(settings, "AUDIT_HASH_SECRET", "") or getattr(settings, "SECRET_KEY", "")).encode("utf-8")
    digest = hmac.new(
        secret,
        f"{AUDIT_PATIENT_KEY_NAMESPACE}{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{AUDIT_PATIENT_KEY_PREFIX}{digest[:AUDIT_PATIENT_KEY_HASH_LENGTH]}"


def rotate_client_audit_patient_keys(apps, schema_editor):
    ClientAuditEvent = apps.get_model("api", "ClientAuditEvent")
    queryset = ClientAuditEvent.objects.exclude(patient_id="")
    for event in queryset.iterator():
        patient_key = _build_patient_key(event.patient_id)
        if patient_key and patient_key != event.patient_id:
            ClientAuditEvent.objects.filter(pk=event.pk).update(patient_id=patient_key)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0015_sanitize_client_audit_event_meta"),
    ]

    operations = [
        migrations.RunPython(rotate_client_audit_patient_keys, migrations.RunPython.noop),
    ]
