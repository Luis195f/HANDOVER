import hashlib
import hmac
import re
from typing import Any

from django.conf import settings


AUDIT_PATIENT_KEY_PREFIX = "ptk2_"
AUDIT_PATIENT_KEY_HASH_LENGTH = 24
AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk2_[0-9a-f]{24}$")
LEGACY_AUDIT_PATIENT_KEY_PATTERN = re.compile(r"^ptk_[0-9a-f]{24}$")
AUDIT_PATIENT_KEY_NAMESPACE = "handover.audit.patient.v2:"

_AUDIT_META_FORBIDDEN_KEYS = {
    "payload",
    "patient",
    "sbar",
    "note",
    "text",
    "details",
    "context",
}
_AUDIT_META_PATIENT_IDENTIFIER_SUFFIXES = (
    "patientid",
    "patientkey",
    "patientreference",
    "patientref",
)
_DROP_META_VALUE = object()


def normalize_audit_patient_identifier(value: Any) -> str:
    candidate = str(value or "").strip()
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


def build_audit_patient_key(value: Any) -> str:
    normalized = normalize_audit_patient_identifier(value)
    if not normalized:
        return ""
    if AUDIT_PATIENT_KEY_PATTERN.fullmatch(normalized):
        return normalized
    secret = getattr(settings, "AUDIT_HASH_SECRET", "") or getattr(settings, "SECRET_KEY", "")
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{AUDIT_PATIENT_KEY_NAMESPACE}{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{AUDIT_PATIENT_KEY_PREFIX}{digest[:AUDIT_PATIENT_KEY_HASH_LENGTH]}"


def _normalize_meta_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _is_patient_identifier_key(normalized_key: str) -> bool:
    return any(
        normalized_key == suffix or normalized_key.endswith(suffix)
        for suffix in _AUDIT_META_PATIENT_IDENTIFIER_SUFFIXES
    )


def _sanitize_client_audit_meta_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, raw_value in value.items():
            key_text = str(key)
            normalized_key = _normalize_meta_key(key_text)
            if normalized_key in _AUDIT_META_FORBIDDEN_KEYS:
                continue
            if _is_patient_identifier_key(normalized_key):
                patient_key = build_audit_patient_key(raw_value)
                if patient_key:
                    sanitized["patientKey"] = patient_key
                continue

            sanitized_value = _sanitize_client_audit_meta_value(raw_value)
            if sanitized_value is _DROP_META_VALUE:
                continue
            sanitized[key_text] = sanitized_value
        return sanitized

    if isinstance(value, list):
        sanitized_items = []
        for item in value:
            sanitized_item = _sanitize_client_audit_meta_value(item)
            if sanitized_item is _DROP_META_VALUE:
                continue
            sanitized_items.append(sanitized_item)
        return sanitized_items

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    return _DROP_META_VALUE


def sanitize_client_audit_meta(value: Any) -> dict[str, Any] | None:
    sanitized = _sanitize_client_audit_meta_value(value)
    if not isinstance(sanitized, dict):
        return None
    return sanitized or None
