import datetime
import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable

from django.conf import settings
from django.db import IntegrityError, close_old_connections
from django.http import HttpRequest
from django.utils import timezone

from backend.api.icea_client import (
    IceaClientConfigurationError,
    IceaHTTPStatusError,
    IceaTransportError,
    load_icea_webhook_settings,
    send_icea_webhook,
)
from backend.api.icea_observability import safe_outbox_event_summary, technical_hash
from backend.api.models import IceaOutboundEvent
from backend.api.icea_pipeline import sync_pipeline_snapshot_from_outbound_event


logger = logging.getLogger(__name__)
RETRY_BASE_SECONDS = 30
RETRY_MAX_DELAY_SECONDS = 1800
UNIT_ID_EXTENSION_SUFFIX = "/unit-id"


@dataclass(frozen=True)
class IceaDeliveryResult:
    delivered: bool
    status: str
    http_status: int | None = None
    latency_ms: int | None = None
    detail: str = ""


def _running_tests() -> bool:
    return bool(
        getattr(settings, "RUNNING_TESTS", False)
        or os.environ.get("PYTEST_CURRENT_TEST")
        or "pytest" in os.environ.get("PYTEST_CURRENT_TEST", "")
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


def _extract_patient_id(resources: list[Dict[str, Any]], full_url_map: dict[str, Dict[str, Any]]) -> str | None:
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
    patient_id = _extract_patient_id(resources, full_url_map)
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


def safe_icea_event_summary(event: IceaOutboundEvent, *, detail: str | None = None) -> dict[str, Any]:
    summary = safe_outbox_event_summary(event, detail=detail)
    return {
        "event": "icea_outbound_delivery",
        "event_id": event.id,
        "request_id": event.request_id,
        "idempotency_key": event.idempotency_key,
        "bundle_hash": technical_hash(event.bundle_id),
        "unit_hash": technical_hash(event.unit_id),
        "status": summary["status"],
        "attempts": summary["attempts"],
        "http_status": summary["httpStatus"],
        "next_retry_at": summary["nextRetryAt"],
        "detail": summary["detail"] or "",
        "error_family": summary["errorFamily"],
    }


def _compute_next_retry_at(attempt: int):
    delay_seconds = min(RETRY_BASE_SECONDS * (2 ** max(attempt - 1, 0)), RETRY_MAX_DELAY_SECONDS)
    return timezone.now() + timezone.timedelta(seconds=delay_seconds)


def _save_event_fields(event: IceaOutboundEvent, *fields: str) -> None:
    event.save(update_fields=list(fields))


def _safe_sync_pipeline_snapshot_from_outbound_event(
    event: IceaOutboundEvent,
    *,
    source: str,
    detail: str | None = None,
) -> None:
    try:
        sync_pipeline_snapshot_from_outbound_event(event, source=source, detail=detail)
    except Exception:
        logger.exception(
            "ICEA pipeline snapshot sync failed",
            extra={"request_id": event.request_id, "source": source},
        )


def _log_delivery(event: IceaOutboundEvent, *, detail: str, latency_ms: int | None = None) -> None:
    payload = safe_icea_event_summary(event, detail=detail)
    if latency_ms is not None:
        payload["latency_ms"] = latency_ms
    logger.info(json.dumps(payload, ensure_ascii=False))


def _schedule_retry(event: IceaOutboundEvent, *, detail: str, http_status: int | None = None) -> IceaDeliveryResult:
    event.status = IceaOutboundEvent.STATUS_RETRY
    event.last_error = detail[:255]
    event.last_http_status = http_status
    event.next_retry_at = _compute_next_retry_at(max(event.attempts, 1))
    _save_event_fields(event, "status", "last_error", "last_http_status", "next_retry_at")
    _safe_sync_pipeline_snapshot_from_outbound_event(event, source="outbox-retry", detail=detail)
    _log_delivery(event, detail=detail)
    return IceaDeliveryResult(
        delivered=False,
        status=event.status,
        http_status=http_status,
        detail=event.last_error,
    )


def _mark_failed(event: IceaOutboundEvent, *, detail: str, http_status: int | None = None) -> IceaDeliveryResult:
    event.status = IceaOutboundEvent.STATUS_FAILED
    event.last_error = detail[:255]
    event.last_http_status = http_status
    event.next_retry_at = None
    _save_event_fields(event, "status", "last_error", "last_http_status", "next_retry_at")
    _safe_sync_pipeline_snapshot_from_outbound_event(event, source="outbox-failed", detail=detail)
    _log_delivery(event, detail=detail)
    return IceaDeliveryResult(
        delivered=False,
        status=event.status,
        http_status=http_status,
        detail=event.last_error,
    )


def attempt_icea_outbound_delivery(event: IceaOutboundEvent, *, force: bool = False) -> IceaDeliveryResult:
    config = load_icea_webhook_settings()
    if not config.enabled:
        return IceaDeliveryResult(delivered=False, status="disabled", detail="webhook_disabled")

    if event.status == IceaOutboundEvent.STATUS_DELIVERED:
        return IceaDeliveryResult(delivered=True, status=event.status, detail="already_delivered")
    if event.status == IceaOutboundEvent.STATUS_FAILED and not force:
        return IceaDeliveryResult(delivered=False, status=event.status, detail="terminal_error")

    now = timezone.now()
    if not force and event.next_retry_at and event.next_retry_at > now:
        return IceaDeliveryResult(delivered=False, status="deferred", detail="not_due")

    if config.validation_errors:
        event.attempts += 1
        event.last_attempt_at = now
        _save_event_fields(event, "attempts", "last_attempt_at")
        if event.attempts < config.retry_max:
            return _schedule_retry(event, detail=config.primary_error)
        return _mark_failed(event, detail=config.primary_error)

    event.attempts += 1
    event.last_attempt_at = now
    _save_event_fields(event, "attempts", "last_attempt_at")

    try:
        response = send_icea_webhook(
            event.payload_json,
            settings_obj=config,
            idempotency_key=event.idempotency_key,
        )
    except IceaClientConfigurationError as exc:
        if event.attempts < config.retry_max:
            return _schedule_retry(event, detail=exc.detail)
        return _mark_failed(event, detail=exc.detail)
    except IceaHTTPStatusError as exc:
        if exc.retryable and event.attempts < config.retry_max:
            return _schedule_retry(event, detail=exc.detail, http_status=exc.http_status)
        return _mark_failed(event, detail=exc.detail, http_status=exc.http_status)
    except IceaTransportError as exc:
        if event.attempts < config.retry_max:
            return _schedule_retry(event, detail=exc.detail)
        return _mark_failed(event, detail=exc.detail)

    event.status = IceaOutboundEvent.STATUS_DELIVERED
    event.last_error = ""
    event.last_http_status = response.status_code
    event.next_retry_at = None
    event.delivered_at = timezone.now()
    _save_event_fields(
        event,
        "status",
        "last_error",
        "last_http_status",
        "next_retry_at",
        "delivered_at",
    )
    _safe_sync_pipeline_snapshot_from_outbound_event(event, source="outbox-delivered", detail=response.safe_detail)
    _log_delivery(event, detail=response.safe_detail, latency_ms=response.latency_ms)
    return IceaDeliveryResult(
        delivered=True,
        status=event.status,
        http_status=response.status_code,
        latency_ms=response.latency_ms,
        detail=response.safe_detail,
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

    try:
        payload = build_icea_webhook_payload(bundle, request)
    except Exception as exc:
        logger.warning(
            "ICEA webhook payload could not be built",
            extra={
                "request_id": _request_id_from_request(request),
                "bundle_hash": technical_hash(_bundle_identifier(bundle)),
                "error": exc.__class__.__name__,
            },
        )
        return None

    defaults = {
        "idempotency_key": str(payload["requestId"]),
        "bundle_id": str(payload["bundleId"]),
        "patient_id": str(payload["patientId"]),
        "unit_id": str(payload["unitId"]),
        "payload_json": payload,
        "status": IceaOutboundEvent.STATUS_QUEUED,
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
        _safe_sync_pipeline_snapshot_from_outbound_event(event, source="outbox-queued", detail="queued_for_delivery")
        schedule_icea_outbound_event_delivery(event.id)
    else:
        logger.info(
            json.dumps(
                {
                    "event": "icea_webhook_duplicate_request",
                    "event_id": event.id,
                    "request_id": event.request_id,
                    "idempotency_key": event.idempotency_key,
                    "bundle_hash": technical_hash(event.bundle_id),
                    "status": event.status,
                },
                ensure_ascii=False,
            )
        )
    return event









