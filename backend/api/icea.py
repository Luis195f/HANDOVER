import datetime
import json
import logging
import os
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from hashlib import sha256
import hmac
from typing import Any, Dict, Iterable, Optional
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.db import IntegrityError, close_old_connections
from django.http import HttpRequest
from django.utils import timezone

from backend.audit.utils import canonical_json
from backend.api.models import IceaOutboundEvent


logger = logging.getLogger(__name__)
RETRYABLE_HTTP_STATUS_CODES = {408, 409, 425, 429}
RETRY_BASE_SECONDS = 30
RETRY_MAX_DELAY_SECONDS = 1800
UNIT_ID_EXTENSION_SUFFIX = "/unit-id"


@dataclass(frozen=True)
class IceaWebhookSettings:
    enabled: bool
    url: str
    secret: str
    timeout_ms: int
    retry_max: int
    anti_replay: bool
    replay_window_seconds: int

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.url and self.secret)


@dataclass(frozen=True)
class IceaDeliveryResult:
    delivered: bool
    status: str
    http_status: int | None = None
    latency_ms: int | None = None
    detail: str = ""


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _running_tests() -> bool:
    return bool(
        getattr(settings, "RUNNING_TESTS", False)
        or os.environ.get("PYTEST_CURRENT_TEST")
        or "pytest" in sys.argv
        or "test" in sys.argv
    )


def _is_secure_or_local(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return True
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}


def load_icea_webhook_settings() -> IceaWebhookSettings:
    url = (os.getenv("ICEA_WEBHOOK_URL") or "").strip()
    secret = (os.getenv("ICEA_WEBHOOK_SECRET") or "").strip()
    enabled = _env_bool("ICEA_WEBHOOK_ENABLED", False)

    if url and not _is_secure_or_local(url):
        if settings.DEBUG or _running_tests():
            logger.warning("ICEA_WEBHOOK_URL is not HTTPS; skipping strict enforcement in dev/tests.")
        else:
            logger.error("ICEA_WEBHOOK_URL must use HTTPS in production.")
            url = ""

    return IceaWebhookSettings(
        enabled=enabled,
        url=url,
        secret=secret,
        timeout_ms=max(_env_int("ICEA_WEBHOOK_TIMEOUT_MS", 2500), 100),
        retry_max=max(_env_int("ICEA_WEBHOOK_RETRY_MAX", 5), 1),
        anti_replay=_env_bool("ICEA_WEBHOOK_ANTI_REPLAY", False),
        replay_window_seconds=max(_env_int("ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS", 300), 1),
    )


def _coerce_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _iter_bundle_entries(bundle: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    for entry in bundle.get("entry") or []:
        if isinstance(entry, dict):
            yield entry


def _resource_index(bundle: Dict[str, Any]) -> tuple[list[Dict[str, Any]], dict[str, Dict[str, Any]]]:
    resources: list[Dict[str, Any]] = []
    full_url_map: dict[str, Dict[str, Any]] = {}
    for entry in _iter_bundle_entries(bundle):
        resource = entry.get("resource")
        if not isinstance(resource, dict):
            continue
        resources.append(resource)
        full_url = entry.get("fullUrl")
        if isinstance(full_url, str) and full_url:
            full_url_map[full_url] = resource
    return resources, full_url_map


def _extract_identifier_value(identifier: Any) -> str | None:
    if isinstance(identifier, dict):
        value = identifier.get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    if isinstance(identifier, list):
        for item in identifier:
            value = _extract_identifier_value(item)
            if value:
                return value
    return None


def _extract_reference_id(reference: Any, full_url_map: dict[str, Dict[str, Any]]) -> str | None:
    if isinstance(reference, dict):
        identifier = _extract_identifier_value(reference.get("identifier"))
        if identifier:
            return identifier
        if isinstance(reference.get("reference"), str):
            return _extract_reference_id(reference.get("reference"), full_url_map)
    if not isinstance(reference, str):
        return None
    raw = reference.strip()
    if not raw:
        return None
    if raw in full_url_map:
        resolved = full_url_map[raw]
        resolved_id = resolved.get("id")
        if isinstance(resolved_id, str) and resolved_id.strip():
            return resolved_id.strip()
    if "/" in raw:
        return raw.rsplit("/", 1)[-1].strip() or None
    return raw


def _extract_patient_id(bundle: Dict[str, Any], resources: list[Dict[str, Any]], full_url_map: dict[str, Dict[str, Any]]) -> str | None:
    for resource in resources:
        if resource.get("resourceType") == "Patient" and isinstance(resource.get("id"), str):
            return str(resource.get("id")).strip() or None
    for resource in resources:
        if resource.get("resourceType") == "Composition":
            patient_id = _extract_reference_id(resource.get("subject"), full_url_map)
            if patient_id:
                return patient_id
    return None


def _extract_encounter_id(resources: list[Dict[str, Any]], full_url_map: dict[str, Dict[str, Any]]) -> str | None:
    for resource in resources:
        if resource.get("resourceType") == "Encounter" and isinstance(resource.get("id"), str):
            return str(resource.get("id")).strip() or None
    for resource in resources:
        if resource.get("resourceType") == "Composition":
            encounter_id = _extract_reference_id(resource.get("encounter"), full_url_map)
            if encounter_id:
                return encounter_id
    return None


def _extract_composition_id(resources: list[Dict[str, Any]]) -> str | None:
    for resource in resources:
        if resource.get("resourceType") == "Composition" and isinstance(resource.get("id"), str):
            return str(resource.get("id")).strip() or None
    return None


def _extract_unit_from_signatures(bundle: Dict[str, Any], full_url_map: dict[str, Dict[str, Any]]) -> str | None:
    for signature in _coerce_list(bundle.get("signature")):
        if not isinstance(signature, dict):
            continue
        on_behalf_of = signature.get("onBehalfOf") or {}
        identifier = _extract_identifier_value(on_behalf_of.get("identifier"))
        if identifier:
            return identifier
        reference_id = _extract_reference_id(on_behalf_of.get("reference"), full_url_map)
        if reference_id:
            return reference_id
        display = on_behalf_of.get("display")
        if isinstance(display, str) and display.strip():
            return display.strip()
    return None


def _extract_unit_from_extensions(resources: list[Dict[str, Any]]) -> str | None:
    for resource in resources:
        for extension in resource.get("extension") or []:
            if not isinstance(extension, dict):
                continue
            url = str(extension.get("url") or "").strip().lower()
            if not url.endswith(UNIT_ID_EXTENSION_SUFFIX):
                continue
            for key in ("valueString", "valueCode", "valueId"):
                value = extension.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _extract_unit_from_roles(resources: list[Dict[str, Any]], full_url_map: dict[str, Dict[str, Any]]) -> str | None:
    for resource in resources:
        if resource.get("resourceType") != "PractitionerRole":
            continue
        organization_id = _extract_reference_id(resource.get("organization"), full_url_map)
        if organization_id:
            return organization_id
        for location in resource.get("location") or []:
            location_id = _extract_reference_id(location, full_url_map)
            if location_id:
                return location_id
    for resource in resources:
        if resource.get("resourceType") in {"Location", "Organization"} and isinstance(resource.get("id"), str):
            return str(resource.get("id")).strip() or None
    return None


def _build_iso8601_timestamp(now=None) -> str:
    current = now or timezone.now()
    return current.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _bundle_identifier(bundle: Dict[str, Any]) -> str | None:
    value = _extract_identifier_value(bundle.get("identifier"))
    if value:
        return value
    bundle_id = bundle.get("id")
    if isinstance(bundle_id, str) and bundle_id.strip():
        return bundle_id.strip()
    return None


def _request_id_from_request(request: HttpRequest) -> str:
    for candidate in (
        request.headers.get("Idempotency-Key"),
        request.headers.get("X-Request-ID"),
        getattr(request, "audit_request_id", ""),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return str(uuid.uuid4())


def build_icea_webhook_payload(bundle: Dict[str, Any], request: HttpRequest) -> Dict[str, Any]:
    resources, full_url_map = _resource_index(bundle)
    request_id = _request_id_from_request(request)
    bundle_id = _bundle_identifier(bundle) or request_id
    patient_id = _extract_patient_id(bundle, resources, full_url_map)
    unit_id = (
        request.headers.get("X-Unit-Id")
        or _extract_unit_from_signatures(bundle, full_url_map)
        or _extract_unit_from_extensions(resources)
        or _extract_unit_from_roles(resources, full_url_map)
    )
    if isinstance(unit_id, str):
        unit_id = unit_id.strip()

    if not patient_id:
        raise ValueError("ICEA webhook payload requires patientId")
    if not unit_id:
        raise ValueError("ICEA webhook payload requires unitId")

    payload: Dict[str, Any] = {
        "bundleId": bundle_id,
        "patientId": patient_id,
        "unitId": unit_id,
        "timestamp": _build_iso8601_timestamp(),
        "requestId": request_id,
        "source": "HANDOVER",
    }

    encounter_id = _extract_encounter_id(resources, full_url_map)
    composition_id = _extract_composition_id(resources)
    bundle_identifier = _bundle_identifier(bundle)
    if encounter_id:
        payload["encounterId"] = encounter_id
    if composition_id:
        payload["compositionId"] = composition_id
    if bundle_identifier:
        payload["bundleIdentifier"] = bundle_identifier

    return payload


def build_icea_webhook_body(payload: Dict[str, Any]) -> bytes:
    return canonical_json(payload)


def build_icea_signature_headers(
    raw_body: bytes,
    *,
    secret: str,
    anti_replay: bool,
    idempotency_key: str,
    timestamp: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    signature_input = raw_body
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }
    if anti_replay:
        signed_timestamp = timestamp or str(int(time.time()))
        signed_nonce = nonce or str(uuid.uuid4())
        signature_input = f"{signed_timestamp}.{signed_nonce}.".encode("utf-8") + raw_body
        headers["X-ICEA-Timestamp"] = signed_timestamp
        headers["X-ICEA-Nonce"] = signed_nonce
    digest = hmac.new(secret.encode("utf-8"), signature_input, sha256).hexdigest()
    headers["X-ICEA-Signature"] = f"sha256={digest}"
    return headers


def _bundle_hash(bundle_id: str) -> str:
    return sha256(bundle_id.encode("utf-8")).hexdigest()[:16] if bundle_id else ""


def _compute_next_retry_at(attempt: int):
    delay_seconds = min(RETRY_BASE_SECONDS * (2 ** max(attempt - 1, 0)), RETRY_MAX_DELAY_SECONDS)
    return timezone.now() + timezone.timedelta(seconds=delay_seconds)


def _should_retry_http_status(status_code: int) -> bool:
    return status_code >= 500 or status_code in RETRYABLE_HTTP_STATUS_CODES


def _sanitize_failure_detail(detail: str) -> str:
    cleaned = (detail or "").strip()
    if not cleaned:
        return "delivery_failed"
    return cleaned[:255]


def _log_delivery(event: IceaOutboundEvent, *, status: str, latency_ms: int | None, http_status: int | None, detail: str) -> None:
    payload = {
        "event": "icea_webhook_delivery",
        "event_id": event.id,
        "request_id": event.request_id,
        "bundle_hash": _bundle_hash(event.bundle_id),
        "status": status,
        "attempts": event.attempts,
        "latency_ms": latency_ms,
        "http_status": http_status,
        "detail": detail,
    }
    logger.info(json.dumps(payload, ensure_ascii=False))


def attempt_icea_outbound_delivery(event: IceaOutboundEvent, *, force: bool = False) -> IceaDeliveryResult:
    config = load_icea_webhook_settings()
    if not config.configured:
        return IceaDeliveryResult(delivered=False, status="disabled", detail="not_configured")
    if event.status == IceaOutboundEvent.STATUS_SENT:
        return IceaDeliveryResult(delivered=True, status="sent", detail="already_sent")
    if event.status == IceaOutboundEvent.STATUS_ERROR and not force:
        return IceaDeliveryResult(delivered=False, status="error", detail="terminal_error")

    now = timezone.now()
    if not force and event.next_retry_at and event.next_retry_at > now:
        return IceaDeliveryResult(delivered=False, status="deferred", detail="not_due")

    raw_body = build_icea_webhook_body(event.payload_json)
    headers = build_icea_signature_headers(
        raw_body,
        secret=config.secret,
        anti_replay=config.anti_replay,
        idempotency_key=event.request_id,
    )

    start = time.monotonic()
    event.attempts += 1
    event.last_attempt_at = now

    try:
        response = httpx.post(
            config.url,
            content=raw_body,
            headers=headers,
            timeout=max(config.timeout_ms / 1000.0, 0.1),
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        if 200 <= response.status_code < 300:
            event.status = IceaOutboundEvent.STATUS_SENT
            event.last_error = ""
            event.next_retry_at = None
            event.sent_at = timezone.now()
            event.save(update_fields=["attempts", "last_attempt_at", "status", "last_error", "next_retry_at", "sent_at"])
            _log_delivery(event, status="sent", latency_ms=latency_ms, http_status=response.status_code, detail="ok")
            return IceaDeliveryResult(delivered=True, status="sent", http_status=response.status_code, latency_ms=latency_ms)

        retryable = _should_retry_http_status(response.status_code)
        event.last_error = _sanitize_failure_detail(f"http_{response.status_code}")
        if retryable and event.attempts < config.retry_max:
            event.status = IceaOutboundEvent.STATUS_PENDING
            event.next_retry_at = _compute_next_retry_at(event.attempts)
        else:
            event.status = IceaOutboundEvent.STATUS_ERROR
            event.next_retry_at = None
        event.save(update_fields=["attempts", "last_attempt_at", "status", "last_error", "next_retry_at"])
        _log_delivery(
            event,
            status=event.status,
            latency_ms=latency_ms,
            http_status=response.status_code,
            detail=event.last_error,
        )
        return IceaDeliveryResult(
            delivered=False,
            status=event.status,
            http_status=response.status_code,
            latency_ms=latency_ms,
            detail=event.last_error,
        )
    except httpx.HTTPError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        event.last_error = _sanitize_failure_detail(exc.__class__.__name__)
        if event.attempts < config.retry_max:
            event.status = IceaOutboundEvent.STATUS_PENDING
            event.next_retry_at = _compute_next_retry_at(event.attempts)
        else:
            event.status = IceaOutboundEvent.STATUS_ERROR
            event.next_retry_at = None
        event.save(update_fields=["attempts", "last_attempt_at", "status", "last_error", "next_retry_at"])
        _log_delivery(event, status=event.status, latency_ms=latency_ms, http_status=None, detail=event.last_error)
        return IceaDeliveryResult(
            delivered=False,
            status=event.status,
            latency_ms=latency_ms,
            detail=event.last_error,
        )


def deliver_icea_outbound_event(event_id: int, *, force: bool = False) -> IceaDeliveryResult:
    event = IceaOutboundEvent.objects.filter(id=event_id).first()
    if event is None:
        return IceaDeliveryResult(delivered=False, status="missing", detail="not_found")
    return attempt_icea_outbound_delivery(event, force=force)


def _deliver_event_in_thread(event_id: int, force: bool) -> None:
    close_old_connections()
    try:
        deliver_icea_outbound_event(event_id, force=force)
    except Exception:
        logger.exception("ICEA webhook delivery thread failed")
    finally:
        close_old_connections()


def schedule_icea_outbound_event_delivery(event_id: int, *, force: bool = False) -> None:
    if _running_tests():
        deliver_icea_outbound_event(event_id, force=force)
        return
    thread = threading.Thread(
        target=_deliver_event_in_thread,
        kwargs={"event_id": event_id, "force": force},
        name=f"icea-webhook-{event_id}",
        daemon=True,
    )
    thread.start()


def enqueue_icea_outbound_event_for_transaction(
    *,
    bundle: Dict[str, Any],
    request: HttpRequest,
) -> IceaOutboundEvent | None:
    config = load_icea_webhook_settings()
    if not config.enabled:
        return None
    if not config.configured:
        logger.warning("ICEA webhook is enabled but not fully configured; skipping delivery.")
        return None

    try:
        payload = build_icea_webhook_payload(bundle, request)
    except Exception as exc:
        logger.warning("ICEA webhook payload could not be built: %s", exc)
        return None

    defaults = {
        "bundle_id": str(payload["bundleId"]),
        "patient_id": str(payload["patientId"]),
        "unit_id": str(payload["unitId"]),
        "payload_json": payload,
        "status": IceaOutboundEvent.STATUS_PENDING,
    }

    try:
        event, created = IceaOutboundEvent.objects.get_or_create(
            request_id=str(payload["requestId"]),
            defaults=defaults,
        )
    except IntegrityError:
        event = IceaOutboundEvent.objects.filter(request_id=str(payload["requestId"])).first()
        created = False

    if event is None:
        return None

    if created:
        schedule_icea_outbound_event_delivery(event.id)
    else:
        logger.info(
            json.dumps(
                {
                    "event": "icea_webhook_duplicate_request",
                    "event_id": event.id,
                    "request_id": event.request_id,
                    "bundle_hash": _bundle_hash(event.bundle_id),
                    "status": event.status,
                },
                ensure_ascii=False,
            )
        )
    return event


