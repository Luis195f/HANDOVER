import json
import logging
from typing import Any, Dict, Optional

from django.conf import settings

from backend.audit.models import AuditEvent
from backend.audit.utils import canonical_json, hash_payload
from backend.security.scope_permissions import _extract_permissions_from_request


logger = logging.getLogger("audit")


def emit_audit_event(
    *,
    event_type: str,
    action: str,
    status: str,
    http_status: Optional[int] = None,
    request=None,
    user_sub: Optional[str] = None,
    scopes: Optional[str] = None,
    resource_type: str = "",
    resource_id: str = "",
    payload_obj: Any = None,
    payload_hash: str = "",
    payload_size: Optional[int] = None,
    meta: Optional[Dict[str, Any]] = None,
    timestamp=None,
    request_id: Optional[str] = None,
) -> None:
    try:
        ip = ""
        user_agent = ""
        if request is not None:
            ip = getattr(request, "audit_client_ip", "") or ""
            user_agent = getattr(request, "audit_user_agent", "") or ""

            if user_sub is None:
                user_sub = getattr(getattr(request, "user", None), "sub", None)

            if scopes is None:
                scope_values = _extract_permissions_from_request(request)
                scopes = " ".join(sorted(scope_values))

            if not request_id:
                request_id = getattr(request, "audit_request_id", "") or ""

        if payload_obj is not None:
            payload_bytes = canonical_json(payload_obj)
            payload_size = len(payload_bytes)
            payload_hash = hash_payload(payload_obj, settings.AUDIT_HASH_SECRET)

        event_data = {
            "event_type": event_type,
            "timestamp": timestamp,
            "user_sub": user_sub,
            "scopes": scopes or "",
            "resource_type": resource_type,
            "resource_id": resource_id,
            "action": action,
            "status": status,
            "http_status": http_status,
            "ip": ip,
            "user_agent": user_agent,
            "request_id": request_id or "",
            "payload_hash": payload_hash,
            "payload_size": payload_size,
            "meta": meta,
        }

        if event_data["timestamp"] is None:
            event_data.pop("timestamp")

        event = AuditEvent.objects.create(**event_data)

        log_payload = {
            "id": event.id,
            **{k: v for k, v in event_data.items() if k != "meta" or v is not None},
        }
        logger.info(json.dumps(log_payload, ensure_ascii=False))
    except Exception:
        logger.exception("Audit event emission failed")
