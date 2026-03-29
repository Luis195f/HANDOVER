import hashlib
import re

from django.db import migrations


AUDIT_PATIENT_KEY_PREFIX = "ptk_"
AUDIT_PATIENT_KEY_HASH_LENGTH = 24
AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk_[0-9a-f]{24}$")
AUDIT_PATIENT_KEY_NAMESPACE = "handover.audit.patient.v1:"


def _normalize_patient_identifier(value: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(candidate):
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
    digest = hashlib.sha256(f"{AUDIT_PATIENT_KEY_NAMESPACE}{normalized}".encode("utf-8")).hexdigest()
    return f"{AUDIT_PATIENT_KEY_PREFIX}{digest[:AUDIT_PATIENT_KEY_HASH_LENGTH]}"


def pseudonymize_client_audit_patient_ids(apps, schema_editor):
    ClientAuditEvent = apps.get_model("api", "ClientAuditEvent")
    queryset = ClientAuditEvent.objects.exclude(patient_id="")
    for event in queryset.iterator():
        patient_key = _build_patient_key(event.patient_id)
        if patient_key and patient_key != event.patient_id:
            ClientAuditEvent.objects.filter(pk=event.pk).update(patient_id=patient_key)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0013_harden_icea_bridge_retry_contract"),
    ]

    operations = [
        migrations.RunPython(pseudonymize_client_audit_patient_ids, migrations.RunPython.noop),
    ]
