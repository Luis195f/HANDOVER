from __future__ import annotations

import json
import re
from hashlib import sha256
from typing import Any


SAFE_DETAIL_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,128}$")

ERROR_FAMILY_RULES: tuple[tuple[str, str], ...] = (
    ("timeout", "timeout"),
    ("connecttimeout", "timeout"),
    ("readtimeout", "timeout"),
    ("transport", "transport"),
    ("connection", "transport"),
    ("network", "transport"),
    ("http_", "remote_http"),
    ("missing_icea_", "configuration"),
    ("invalid_icea_", "configuration"),
    ("icea_bridge_disabled", "configuration"),
    ("icea_pipeline_not_configured", "configuration"),
    ("webhook_", "configuration"),
    ("https_required", "configuration"),
    ("disabled", "disabled"),
    ("stale", "stale"),
    ("insufficient_evidence", "insufficient_evidence"),
    ("unauthorized", "auth"),
    ("forbidden", "auth"),
    ("token", "auth"),
    ("storage", "storage"),
    ("bundle_unavailable", "storage"),
    ("clinicalbundlestorageerror", "storage"),
    ("validation", "validation"),
)


def technical_hash(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    return sha256(normalized.encode("utf-8")).hexdigest()[:16]


def stable_payload_hash(payload: Any) -> str:
    try:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except TypeError:
        raw = str(payload)
    return technical_hash(raw)


def safe_event_id(source: str, record_id: Any) -> str:
    return f"{source}:{record_id}"


def http_status_family(http_status: int | None) -> str | None:
    if not isinstance(http_status, int) or http_status <= 0:
        return None
    return f"{http_status // 100}xx"


def redact_safe_message(message: Any, *, fallback: str | None = None) -> str | None:
    if not isinstance(message, str):
        return fallback
    normalized = message.strip()
    if not normalized:
        return fallback
    if SAFE_DETAIL_RE.fullmatch(normalized):
        return normalized[:128]
    return fallback


def classify_error_family(*, detail: Any = None, http_status: int | None = None) -> str | None:
    if http_status is not None:
        if http_status in {401, 403}:
            return "auth"
        if http_status == 408:
            return "timeout"
        if http_status >= 500:
            return "remote_http"
        if http_status >= 400:
            return "remote_rejected"

    normalized = str(detail or "").strip().lower()
    if not normalized:
        return None
    for token, family in ERROR_FAMILY_RULES:
        if token in normalized:
            return family
    if SAFE_DETAIL_RE.fullmatch(normalized):
        return "remote_error"
    return "redacted"


def latency_ms(*, started_at, finished_at) -> int | None:
    if started_at is None or finished_at is None:
        return None
    delta = finished_at - started_at
    milliseconds = int(delta.total_seconds() * 1000)
    return milliseconds if milliseconds >= 0 else None


def safe_outbox_event_summary(event, *, detail: str | None = None) -> dict[str, Any]:
    redacted_detail = redact_safe_message(detail or event.last_error, fallback=None)
    return {
        "eventId": safe_event_id("outbox", event.id),
        "source": "outbox",
        "requestId": event.request_id,
        "bundleId": event.bundle_id,
        "unitId": event.unit_id or None,
        "payloadHash": stable_payload_hash(event.payload_json),
        "status": event.status,
        "statusFamily": http_status_family(event.last_http_status),
        "errorFamily": classify_error_family(detail=detail or event.last_error, http_status=event.last_http_status),
        "attempts": event.attempts,
        "httpStatus": event.last_http_status,
        "latencyMs": latency_ms(started_at=event.last_attempt_at, finished_at=event.delivered_at),
        "nextRetryAt": event.next_retry_at.isoformat() if event.next_retry_at else None,
        "detail": redacted_detail,
        "createdAt": event.created_at.isoformat(),
        "updatedAt": (
            event.delivered_at or event.last_attempt_at or event.next_retry_at or event.created_at
        ).isoformat(),
    }


def safe_bridge_request_summary(bridge_request) -> dict[str, Any]:
    redacted_detail = redact_safe_message(bridge_request.last_error, fallback=None)
    return {
        "eventId": safe_event_id("bridge", bridge_request.id),
        "source": "bridge",
        "requestId": bridge_request.request_id,
        "bundleId": bridge_request.bundle_id,
        "unitId": bridge_request.unit_id or None,
        "payloadHash": bridge_request.payload_hash,
        "status": bridge_request.status,
        "statusFamily": http_status_family(bridge_request.last_http_status),
        "errorFamily": classify_error_family(
            detail=bridge_request.last_error,
            http_status=bridge_request.last_http_status,
        ),
        "attempts": bridge_request.attempts,
        "httpStatus": bridge_request.last_http_status,
        "latencyMs": latency_ms(started_at=bridge_request.sent_at, finished_at=bridge_request.received_at),
        "scoringMode": bridge_request.scoring_mode,
        "provisional": bridge_request.provisional,
        "insufficientEvidence": bridge_request.insufficient_evidence,
        "detail": redacted_detail,
        "createdAt": bridge_request.created_at.isoformat(),
        "updatedAt": bridge_request.updated_at.isoformat(),
    }


def safe_pipeline_event_summary(event) -> dict[str, Any]:
    redacted_detail = redact_safe_message(event.detail, fallback=None)
    payload = event.payload_json if isinstance(event.payload_json, dict) else {}
    remote_refs = {
        key: payload[key]
        for key in ("requestId", "bundleId", "unitId", "jobId", "reportId", "summaryId")
        if key in payload and payload[key] not in (None, "")
    }
    return {
        "eventId": safe_event_id("pipeline", event.id),
        "source": "pipeline",
        "requestId": event.request_id or None,
        "bundleId": event.bundle_id or None,
        "unitId": event.unit_id or None,
        "payloadHash": stable_payload_hash(remote_refs) if remote_refs else None,
        "status": event.status,
        "statusFamily": http_status_family(event.http_status),
        "errorFamily": classify_error_family(detail=event.detail, http_status=event.http_status),
        "stage": event.stage,
        "action": event.action or None,
        "httpStatus": event.http_status,
        "detail": redacted_detail,
        "createdAt": event.created_at.isoformat(),
        "updatedAt": event.created_at.isoformat(),
    }
