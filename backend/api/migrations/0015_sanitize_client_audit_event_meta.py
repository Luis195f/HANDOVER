import hashlib
import re

from django.db import migrations


AUDIT_PATIENT_KEY_PREFIX = "ptk_"
AUDIT_PATIENT_KEY_HASH_LENGTH = 24
AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk_[0-9a-f]{24}$")
AUDIT_PATIENT_KEY_NAMESPACE = "handover.audit.patient.v1:"

AUDIT_META_FORBIDDEN_KEYS = {
    "payload",
    "patient",
    "sbar",
    "note",
    "text",
    "details",
    "context",
}
AUDIT_META_PATIENT_IDENTIFIER_SUFFIXES = (
    "patientid",
    "patientkey",
    "patientreference",
    "patientref",
)
DROP_META_VALUE = object()


def _normalize_patient_identifier(value):
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(candidate):
        return candidate
    if candidate.startswith("Patient/"):
        _, _, suffix = candidate.partition("/")
        normalized = suffix.strip()
        return normalized or candidate
    return candidate


def _build_patient_key(value):
    normalized = _normalize_patient_identifier(value)
    if not normalized:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(normalized):
        return normalized
    digest = hashlib.sha256(f"{AUDIT_PATIENT_KEY_NAMESPACE}{normalized}".encode("utf-8")).hexdigest()
    return f"{AUDIT_PATIENT_KEY_PREFIX}{digest[:AUDIT_PATIENT_KEY_HASH_LENGTH]}"


def _normalize_meta_key(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _is_patient_identifier_key(normalized_key):
    return any(
        normalized_key == suffix or normalized_key.endswith(suffix)
        for suffix in AUDIT_META_PATIENT_IDENTIFIER_SUFFIXES
    )


def _sanitize_meta_value(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, raw_value in value.items():
            key_text = str(key)
            normalized_key = _normalize_meta_key(key_text)
            if normalized_key in AUDIT_META_FORBIDDEN_KEYS:
                continue
            if _is_patient_identifier_key(normalized_key):
                patient_key = _build_patient_key(raw_value)
                if patient_key:
                    sanitized["patientKey"] = patient_key
                continue

            sanitized_value = _sanitize_meta_value(raw_value)
            if sanitized_value is DROP_META_VALUE:
                continue
            sanitized[key_text] = sanitized_value
        return sanitized

    if isinstance(value, list):
        sanitized_items = []
        for item in value:
            sanitized_item = _sanitize_meta_value(item)
            if sanitized_item is DROP_META_VALUE:
                continue
            sanitized_items.append(sanitized_item)
        return sanitized_items

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    return DROP_META_VALUE


def sanitize_client_audit_event_meta(apps, schema_editor):
    ClientAuditEvent = apps.get_model("api", "ClientAuditEvent")
    queryset = ClientAuditEvent.objects.exclude(meta__isnull=True)
    for event in queryset.iterator():
        sanitized = _sanitize_meta_value(event.meta)
        sanitized_meta = sanitized if isinstance(sanitized, dict) and sanitized else None
        if sanitized_meta != event.meta:
            ClientAuditEvent.objects.filter(pk=event.pk).update(meta=sanitized_meta)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0014_pseudonymize_client_audit_patient_ids"),
    ]

    operations = [
        migrations.RunPython(sanitize_client_audit_event_meta, migrations.RunPython.noop),
    ]
