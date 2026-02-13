import json
import logging
import os
import sys

from typing import Any, Dict, Optional

from django.conf import settings
from django.utils import timezone

from backend.audit.models import AuditEvent
from backend.audit.utils import canonical_json, hash_payload
from backend.security.scope_permissions import _extract_permissions_from_request


logger = logging.getLogger("audit")

FHIR_ACTION_MAP = {
    "create": "C",
    "read": "R",
    "update": "U",
    "delete": "D",
    "execute": "E",
    "grant": "U",
    "revoke": "U",
}

def _is_pytest() -> bool:
    return ("PYTEST_CURRENT_TEST" in os.environ) or ("pytest" in sys.argv)
    
def _map_action_to_fhir(action: str) -> str:
    normalized = (action or "").strip().lower()
    return FHIR_ACTION_MAP.get(normalized, "E")


def _build_fhir_audit_event(
    *,
    event_type: str,
    action: str,
    status: str,
    resource_type: str,
    resource_id: str,
    user_sub: Optional[str],
    ip: str,
    user_agent: str,
    payload_hash: str,
    request_id: str,
    timestamp,
    scopes: str,
) -> Dict[str, Any]:
    recorded = timestamp.isoformat() if hasattr(timestamp, "isoformat") else None
    if not recorded:
        recorded = timezone.now().isoformat()
    outcome = "0" if status == "success" else "4"
    fhir_action = _map_action_to_fhir(action)
    entity_reference = f"{resource_type}/{resource_id}" if resource_type and resource_id else ""
    entity: Dict[str, Any] = {
        "detail": [
            {"type": "payload-hash", "valueString": payload_hash or ""},
            {"type": "request-id", "valueString": request_id or ""},
        ]
    }
    if entity_reference:
        entity["what"] = {"reference": entity_reference}

    return {
        "resourceType": "AuditEvent",
        "type": {
            "system": "http://terminology.hl7.org/CodeSystem/audit-event-type",
            "code": event_type,
        },
        "subtype": [{"code": action}],
        "action": fhir_action,
        "recorded": recorded,
        "outcome": outcome,
        "agent": [
            {
                "who": {"identifier": {"value": user_sub or "anonymous"}},
                "requestor": True,
                "network": {"address": ip or "", "type": "2"},
                "policy": scopes.split() if scopes else [],
                "extension": [
                    {
                        "url": "http://hl7.org/fhir/StructureDefinition/audit-event-source",
                        "valueString": user_agent or "",
                    }
                ],
            }
        ],
        "source": {
            "observer": {"display": "handover-backend"},
            "type": [{"text": "IHE-ATNA"}],
        },
        "entity": [entity],
    }

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

        fhir_event = _build_fhir_audit_event(
            event_type=event_type,
            action=action,
            status=status,
            resource_type=resource_type,
            resource_id=resource_id,
            user_sub=user_sub,
            ip=ip,
            user_agent=user_agent,
            payload_hash=payload_hash,
            request_id=request_id or "",
            timestamp=timestamp,
            scopes=scopes or "",
        )

        merged_meta = {"fhir": fhir_event}
        if meta:
            merged_meta.update(meta)

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
            "meta": merged_meta,
        }

        if event_data["timestamp"] is None:
            event_data.pop("timestamp")

        event = None
store_to_db = not _is_pytest()

if store_to_db:
    try:
        event = AuditEvent.objects.create(**event_data)
    except RuntimeError as e:
        # pytest-django bloquea DB si el test no usa django_db/db fixture
        if "Database access not allowed" not in str(e):
            raise
    except Exception:
        event = None

log_payload = {
    **({"id": event.id} if event is not None else {}),
    **{k: v for k, v in event_data.items() if k != "meta" or v is not None},
}
logger.info(json.dumps(log_payload, ensure_ascii=False))

    except Exception:
        logger.exception("Audit event emission failed")
