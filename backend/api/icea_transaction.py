from __future__ import annotations

import logging
import uuid
from typing import Any, Callable

from django.conf import settings
from django.db import IntegrityError
from django.http import HttpRequest

from backend.api.clinical_storage import encrypt_bundle_document
from backend.api.icea import enqueue_icea_outbound_event_for_transaction
from backend.api.icea_bridge_service import enqueue_icea_bridge_request_for_transaction
from backend.api.icea_pipeline import ensure_pipeline_snapshot_from_bundle
from backend.api.models import HandoverBundleRecord


logger = logging.getLogger(__name__)


def _extract_request_id(request: HttpRequest) -> str:
    for candidate in (
        request.headers.get("Idempotency-Key"),
        request.META.get("HTTP_IDEMPOTENCY_KEY"),
        request.headers.get("X-Request-ID"),
        request.META.get("HTTP_X_REQUEST_ID"),
        getattr(request, "audit_request_id", ""),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return str(uuid.uuid4())


def _extract_bundle_identifier(
    bundle: dict[str, Any],
    request: HttpRequest,
    *,
    request_id: str | None = None,
) -> str:
    identifier = bundle.get("identifier")
    if isinstance(identifier, dict):
        value = identifier.get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    bundle_id = bundle.get("id")
    if isinstance(bundle_id, str) and bundle_id.strip():
        return bundle_id.strip()
    return request_id or _extract_request_id(request)


def _extract_patient_id_from_bundle(bundle: dict[str, Any]) -> str:
    for entry in bundle.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        resource = entry.get("resource")
        if not isinstance(resource, dict):
            continue
        if resource.get("resourceType") == "Patient":
            patient_id = resource.get("id")
            if isinstance(patient_id, str) and patient_id.strip():
                return patient_id.strip()
    return "unknown"


def persist_handover_bundle_record(*, bundle: dict[str, Any], request: HttpRequest) -> None:
    request_id = _extract_request_id(request)
    encrypted_bundle, encryption_metadata = encrypt_bundle_document(bundle)
    defaults = {
        "bundle_id": _extract_bundle_identifier(bundle, request, request_id=request_id),
        "patient_id": _extract_patient_id_from_bundle(bundle),
        "unit_id": str(request.headers.get("X-Unit-Id") or "unknown").strip() or "unknown",
        "bundle_json": encrypted_bundle,
        "expires_at": HandoverBundleRecord.default_expiry(),
        "encryption_metadata": {
            **encryption_metadata,
            "retention_days": settings.HANDOVER_BUNDLE_RETENTION_DAYS,
        },
    }
    try:
        HandoverBundleRecord.objects.get_or_create(request_id=request_id, defaults=defaults)
    except IntegrityError:
        logger.info("handover_bundle_duplicate_request", extra={"request_id": request_id})


def persist_successful_transaction_icea_side_effects(
    *,
    bundle: dict[str, Any],
    request: HttpRequest,
    outbox_callback: Callable[..., None] | None = None,
    persist_bundle_record: Callable[..., None] | None = None,
    snapshot_callback: Callable[..., None] | None = None,
    bridge_callback: Callable[..., None] | None = None,
) -> None:
    outbox_callback = outbox_callback or enqueue_icea_outbound_event_for_transaction
    snapshot_callback = snapshot_callback or ensure_pipeline_snapshot_from_bundle
    bridge_callback = bridge_callback or enqueue_icea_bridge_request_for_transaction

    try:
        outbox_callback(bundle=bundle, request=request)
    except Exception:
        logger.exception("ICEA outbox enqueue failed after successful clinical transaction")

    if persist_bundle_record is not None:
        try:
            persist_bundle_record(bundle=bundle, request=request)
        except Exception:
            logger.exception("ICEA bundle persistence failed after successful clinical transaction")

    try:
        snapshot_callback(bundle=bundle, request=request)
    except Exception:
        logger.exception("ICEA pipeline snapshot persistence failed after successful clinical transaction")

    try:
        bridge_callback(bundle=bundle, request=request)
    except Exception:
        logger.exception("ICEA bridge enqueue failed after successful clinical transaction")



