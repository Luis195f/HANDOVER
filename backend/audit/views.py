from typing import Any, Dict, List

from django.db import transaction
from django.utils import timezone
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.views import APIView

from backend.audit.serializers import AuditEventIngestSerializer
from backend.audit.service import AuditPersistenceError, emit_audit_event
from backend.security.auth import Auth0JWTAuthentication
from backend.security.permissions_roles import HasAnyRole
from backend.security.scope_permissions import HasAnyScope


class AuditEventsIngestView(APIView):
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("audit:write", "handover:write"),
    ]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer]

    def post(self, request):
        data = request.data
        if not isinstance(data, (dict, list)):
            return Response({"errors": ["Invalid audit payload."], "code": "INVALID_AUDIT"}, status=422)
        raw_events = data if isinstance(data, list) else [data]
        events: List[Dict[str, Any]] = []
        try:
            for raw_event in raw_events:
                serializer = AuditEventIngestSerializer(data=raw_event)
                serializer.is_valid(raise_exception=True)
                events.append(serializer.validated_data)
        except ValidationError:
            return Response({"errors": ["Invalid audit payload."], "code": "INVALID_AUDIT"}, status=422)

        try:
            with transaction.atomic():
                for event in events:
                    meta = {"client": event.get("client")} if event.get("client") else None
                    emit_audit_event(
                        event_type=event["eventType"],
                        action=event["action"],
                        status=event["status"],
                        http_status=event.get("httpStatus"),
                        request=request,
                        resource_type=event.get("resourceType", ""),
                        resource_id=event.get("resourceId", ""),
                        payload_hash=event.get("payloadHash", ""),
                        payload_size=event.get("payloadSize"),
                        meta=meta,
                        timestamp=event.get("timestamp") or timezone.now(),
                        request_id=event.get("requestId") or getattr(request, "audit_request_id", ""),
                        required=True,
                    )
        except AuditPersistenceError:
            return Response({"code": "audit_unavailable"}, status=503)

        return Response({"status": "ok", "count": len(events)}, status=201)
