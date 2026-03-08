from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.icea_pipeline import (
    IceaPipelineConfigurationError,
    IceaPipelineHTTPStatusError,
    IceaPipelineService,
    IceaPipelineTransportError,
    build_dashboard_summary,
    record_pipeline_activity,
    record_status_refresh,
    resolve_pipeline_snapshot,
    serialize_pipeline_event,
    serialize_pipeline_snapshot,
    _compact_payload_for_stage,
)
from backend.api.models import IceaPipelineEvent
from backend.api.views import AuthenticatedAPIView
from backend.security.permissions_roles import HasAnyRole


ALLOWED_ACTIONS = {
    "normalize",
    "build-windows",
    "build-dataset",
    "refresh-dashboard-summary",
    "causal-report",
}
QUERY_ROLES = HasAnyRole.required("supervisor", "admin")
ACTION_ROLES = HasAnyRole.required("admin")


def _extract_actor_sub(request) -> str:
    user = getattr(request, "user", None)
    for candidate in (
        getattr(user, "sub", None),
        (request.auth or {}).get("sub") if isinstance(getattr(request, "auth", None), dict) else None,
        getattr(getattr(user, "claims", None), "get", lambda _key: None)("sub") if getattr(user, "claims", None) else None,
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _build_selectors(data: dict[str, Any]) -> dict[str, str]:
    selectors: dict[str, str] = {}
    for source_key, target_key in (
        ("requestId", "requestId"),
        ("request_id", "requestId"),
        ("bundleId", "bundleId"),
        ("bundle_id", "bundleId"),
        ("patientId", "patientId"),
        ("patient_id", "patientId"),
        ("unitId", "unitId"),
        ("unit_id", "unitId"),
    ):
        value = data.get(source_key)
        if isinstance(value, str) and value.strip() and target_key not in selectors:
            selectors[target_key] = value.strip()
    return selectors


def _merge_snapshot_selectors(selectors: dict[str, str]) -> dict[str, str]:
    if not selectors or not any(selectors.values()):
        return selectors

    snapshot = resolve_pipeline_snapshot(**selectors)
    if not snapshot:
        return selectors
    merged = dict(selectors)
    merged.setdefault("requestId", snapshot.request_id)
    merged.setdefault("bundleId", snapshot.bundle_id)
    merged.setdefault("patientId", snapshot.patient_id)
    merged.setdefault("unitId", snapshot.unit_id)
    return merged


class IceaPipelineStatusView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        selectors = _merge_snapshot_selectors(_build_selectors(request.query_params))
        if not any(selectors.get(key) for key in ("requestId", "bundleId", "patientId")):
            return Response({"detail": "requestId, bundleId or patientId is required.", "code": "missing_selector"}, status=400)

        snapshot = resolve_pipeline_snapshot(**selectors)
        remote_error = None
        should_refresh = not request.query_params.get("refresh") or _truthy(request.query_params.get("refresh"))
        if should_refresh:
            service = IceaPipelineService()
            try:
                remote_response = service.get_status(selectors)
                snapshot = record_status_refresh(
                    selectors=selectors,
                    payload=remote_response.body_json,
                    actor_sub=_extract_actor_sub(request),
                ) or snapshot
            except IceaPipelineConfigurationError as exc:
                remote_error = {"code": exc.detail}
            except IceaPipelineTransportError as exc:
                remote_error = {"code": "icea_transport_error", "detail": exc.detail}
            except IceaPipelineHTTPStatusError as exc:
                remote_error = {
                    "code": "icea_remote_status_error",
                    "detail": exc.detail,
                    "remoteStatus": exc.http_status,
                }

        if snapshot is None:
            return Response({"detail": "Pipeline snapshot not found.", "code": "icea_snapshot_not_found"}, status=404)

        payload = {"snapshot": serialize_pipeline_snapshot(snapshot)}
        if remote_error is not None:
            payload["remoteError"] = remote_error
        return Response(payload, status=200)


class IceaPipelineEventsView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id = str(request.query_params.get("unitId") or "").strip()
        stage = str(request.query_params.get("stage") or "").strip()
        try:
            limit = int(request.query_params.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 100))

        queryset = IceaPipelineEvent.objects.all()
        if unit_id:
            queryset = queryset.filter(unit_id=unit_id)
        if stage:
            queryset = queryset.filter(stage=stage)
        return Response({"results": [serialize_pipeline_event(event) for event in queryset[:limit]]}, status=200)


class IceaDashboardSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id = str(request.query_params.get("unitId") or "").strip() or None
        try:
            limit = int(request.query_params.get("eventsLimit") or 20)
        except (TypeError, ValueError):
            limit = 20
        return Response(build_dashboard_summary(unit_id=unit_id, events_limit=limit), status=200)


class IceaPipelineActionView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, ACTION_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def post(self, request, action: str):
        normalized_action = str(action or "").strip().lower()
        if normalized_action not in ALLOWED_ACTIONS:
            return Response({"detail": "Unsupported ICEA action.", "code": "unsupported_action"}, status=404)

        payload = request.data if isinstance(request.data, dict) else {}
        selectors = _merge_snapshot_selectors(_build_selectors(payload))
        actor_sub = _extract_actor_sub(request)

        if normalized_action == "refresh-dashboard-summary":
            unit_id = selectors.get("unitId")
            if not unit_id:
                return Response({"detail": "unitId is required.", "code": "missing_unit_id"}, status=400)
        elif not any(selectors.get(key) for key in ("requestId", "bundleId", "patientId")):
            return Response({"detail": "requestId, bundleId or patientId is required.", "code": "missing_selector"}, status=400)

        service = IceaPipelineService()
        try:
            remote_response = service.run_action(normalized_action, selectors)
        except IceaPipelineConfigurationError as exc:
            return Response({"detail": exc.detail, "code": "icea_not_configured"}, status=503)
        except IceaPipelineTransportError as exc:
            return Response({"detail": exc.detail, "code": "icea_transport_error"}, status=502)
        except IceaPipelineHTTPStatusError as exc:
            return Response(
                {
                    "detail": exc.detail,
                    "code": "icea_remote_error",
                    "remoteStatus": exc.http_status,
                },
                status=502,
            )

        body_json = remote_response.body_json
        snapshot = None
        if normalized_action == "refresh-dashboard-summary":
            IceaPipelineEvent.objects.create(
                request_id="",
                bundle_id="",
                patient_id="",
                unit_id=selectors.get("unitId") or "",
                stage="dashboard-summary",
                action=normalized_action,
                status="succeeded",
                source="manual-action",
                actor_sub=actor_sub,
                http_status=remote_response.status_code,
                payload_json=_compact_payload_for_stage("dashboard-summary", body_json),
            )
        else:
            request_id = selectors.get("requestId") or selectors.get("bundleId") or selectors.get("patientId") or selectors.get("unitId") or ""
            snapshot = record_pipeline_activity(
                request_id=request_id,
                bundle_id=selectors.get("bundleId") or "",
                patient_id=selectors.get("patientId") or "",
                unit_id=selectors.get("unitId") or "",
                stage="dashboard-summary" if normalized_action == "refresh-dashboard-summary" else normalized_action,
                action=normalized_action,
                status="succeeded",
                source="manual-action",
                actor_sub=actor_sub,
                http_status=remote_response.status_code,
                payload=body_json,
            )

        response_payload = {
            "action": normalized_action,
            "result": {
                "statusCode": remote_response.status_code,
                "payload": body_json,
            },
        }
        if snapshot is not None:
            response_payload["snapshot"] = serialize_pipeline_snapshot(snapshot)
        return Response(response_payload, status=200)


