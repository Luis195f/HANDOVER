
import logging
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.db.models import Count, Max, Q
from django.http import HttpRequest
from django.utils import timezone

from backend.api.models import IceaOutboundEvent, IceaPipelineEvent, IceaPipelineSnapshot


logger = logging.getLogger(__name__)
KNOWN_PIPELINE_ACTIONS = frozenset(
    {
        "normalize",
        "build-windows",
        "build-dataset",
        "refresh-dashboard-summary",
        "causal-report",
    }
)
ACTION_TO_STAGE = {
    "normalize": "normalize",
    "build-windows": "build-windows",
    "build-dataset": "build-dataset",
    "refresh-dashboard-summary": "dashboard-summary",
    "causal-report": "causal-report",
}
STATUS_ALIASES = {
    "accepted": IceaPipelineSnapshot.STATUS_ACCEPTED,
    "queued": IceaPipelineSnapshot.STATUS_QUEUED,
    "pending": IceaPipelineSnapshot.STATUS_QUEUED,
    "running": IceaPipelineSnapshot.STATUS_RUNNING,
    "processing": IceaPipelineSnapshot.STATUS_RUNNING,
    "retry": IceaPipelineSnapshot.STATUS_RETRY,
    "delivered": IceaPipelineSnapshot.STATUS_DELIVERED,
    "success": IceaPipelineSnapshot.STATUS_SUCCEEDED,
    "succeeded": IceaPipelineSnapshot.STATUS_SUCCEEDED,
    "completed": IceaPipelineSnapshot.STATUS_SUCCEEDED,
    "failed": IceaPipelineSnapshot.STATUS_FAILED,
    "error": IceaPipelineSnapshot.STATUS_FAILED,
    "empty": IceaPipelineSnapshot.STATUS_EMPTY,
    "not-configured": IceaPipelineSnapshot.STATUS_NOT_CONFIGURED,
    "not_configured": IceaPipelineSnapshot.STATUS_NOT_CONFIGURED,
}
STAGE_KEY_ALIASES = {
    "normalize": "normalize",
    "build-windows": "build-windows",
    "build_windows": "build-windows",
    "buildwindows": "build-windows",
    "build-dataset": "build-dataset",
    "build_dataset": "build-dataset",
    "builddataset": "build-dataset",
    "dashboard-summary": "dashboard-summary",
    "dashboard_summary": "dashboard-summary",
    "dashboardsummary": "dashboard-summary",
    "causal-report": "causal-report",
    "causal_report": "causal-report",
    "causalreport": "causal-report",
    "ingest": "ingest",
}
REMOTE_REF_KEYS = ("requestId", "bundleId", "patientId", "unitId", "jobId", "reportId", "summaryId")


class IceaPipelineClientError(Exception):
    def __init__(self, detail: str, *, http_status: int | None = None):
        super().__init__(detail)
        self.detail = detail
        self.http_status = http_status


class IceaPipelineConfigurationError(IceaPipelineClientError):
    pass


class IceaPipelineTransportError(IceaPipelineClientError):
    pass


class IceaPipelineHTTPStatusError(IceaPipelineClientError):
    pass


@dataclass(frozen=True)
class IceaPipelineSettings:
    enabled: bool
    base_url: str
    token_url: str
    client_id: str
    client_secret: str
    scope: str
    audience: str
    bearer_token: str
    timeout_ms: int
    verify_tls: bool
    status_path: str
    normalize_path: str
    build_windows_path: str
    build_dataset_path: str
    dashboard_summary_path: str
    causal_report_path: str
    validation_errors: tuple[str, ...] = ()

    @property
    def configured(self) -> bool:
        return self.enabled and not self.validation_errors

    @property
    def primary_error(self) -> str:
        return self.validation_errors[0] if self.validation_errors else ""


@dataclass(frozen=True)
class IceaRemoteResponse:
    status_code: int
    body_json: dict[str, Any] | list[Any] | None


def _running_tests() -> bool:
    return bool(
        getattr(settings, "RUNNING_TESTS", False)
        or os.environ.get("PYTEST_CURRENT_TEST")
        or "pytest" in sys.argv
        or "test" in sys.argv
    )


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


def _is_secure_or_local(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return True
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}


def load_icea_pipeline_settings() -> IceaPipelineSettings:
    base_url = (os.getenv("ICEA_API_BASE_URL") or "").strip().rstrip("/")
    token_url = (os.getenv("ICEA_API_TOKEN_URL") or "").strip()
    client_id = (os.getenv("ICEA_API_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("ICEA_API_CLIENT_SECRET") or "").strip()
    scope = (os.getenv("ICEA_API_SCOPE") or "").strip()
    audience = (os.getenv("ICEA_API_AUDIENCE") or "").strip()
    bearer_token = (os.getenv("ICEA_API_BEARER_TOKEN") or "").strip()
    timeout_ms = max(_env_int("ICEA_API_TIMEOUT_MS", 5000), 100)
    verify_tls = _env_bool("ICEA_API_VERIFY_TLS", True)

    errors: list[str] = []
    if base_url:
        if not _is_secure_or_local(base_url):
            if settings.DEBUG or _running_tests():
                logger.warning("ICEA_API_BASE_URL is not HTTPS; skipping strict enforcement in dev/tests.")
            else:
                errors.append("icea_api_base_url_https_required")
        if not bearer_token and not (token_url and client_id and client_secret):
            errors.append("missing_icea_s2s_credentials")
    enabled = bool(base_url)

    return IceaPipelineSettings(
        enabled=enabled,
        base_url=base_url,
        token_url=token_url,
        client_id=client_id,
        client_secret=client_secret,
        scope=scope,
        audience=audience,
        bearer_token=bearer_token,
        timeout_ms=timeout_ms,
        verify_tls=verify_tls,
        status_path=(os.getenv("ICEA_API_STATUS_PATH") or "/api/v1/pipeline/status/").strip(),
        normalize_path=(os.getenv("ICEA_API_NORMALIZE_PATH") or "/api/v1/pipeline/normalize/").strip(),
        build_windows_path=(os.getenv("ICEA_API_BUILD_WINDOWS_PATH") or "/api/v1/pipeline/build-windows/").strip(),
        build_dataset_path=(os.getenv("ICEA_API_BUILD_DATASET_PATH") or "/api/v1/pipeline/build-dataset/").strip(),
        dashboard_summary_path=(os.getenv("ICEA_API_DASHBOARD_SUMMARY_PATH") or "/api/v1/pipeline/dashboard-summary/").strip(),
        causal_report_path=(os.getenv("ICEA_API_CAUSAL_REPORT_PATH") or "/api/v1/pipeline/causal-report/").strip(),
        validation_errors=tuple(errors),
    )


class IceaPipelineService:
    def __init__(self, settings_obj: IceaPipelineSettings | None = None):
        self.settings = settings_obj or load_icea_pipeline_settings()

    def get_status(self, selectors: dict[str, str]) -> IceaRemoteResponse:
        return self._request("GET", self.settings.status_path, params=selectors)

    def run_action(self, action: str, selectors: dict[str, str]) -> IceaRemoteResponse:
        if action not in KNOWN_PIPELINE_ACTIONS:
            raise IceaPipelineConfigurationError("unsupported_action")
        if action == "normalize":
            return self._request("POST", self.settings.normalize_path, json_body=selectors)
        if action == "build-windows":
            return self._request("POST", self.settings.build_windows_path, json_body=selectors)
        if action == "build-dataset":
            return self._request("POST", self.settings.build_dataset_path, json_body=selectors)
        if action == "refresh-dashboard-summary":
            return self._request("POST", self.settings.dashboard_summary_path, json_body=selectors)
        return self._request("GET", self.settings.causal_report_path, params=selectors)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: dict[str, str] | None = None,
    ) -> IceaRemoteResponse:
        if not self.settings.enabled:
            raise IceaPipelineConfigurationError("icea_pipeline_not_configured")
        if self.settings.validation_errors:
            raise IceaPipelineConfigurationError(self.settings.primary_error)

        url = _join_url(self.settings.base_url, path)
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._get_access_token()}",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        try:
            response = httpx.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=headers,
                timeout=max(self.settings.timeout_ms / 1000.0, 0.1),
                verify=self.settings.verify_tls,
            )
        except httpx.HTTPError as exc:
            raise IceaPipelineTransportError(exc.__class__.__name__) from exc

        body_json = _parse_json_body(response)
        if response.status_code >= 400:
            raise IceaPipelineHTTPStatusError(_extract_remote_detail(body_json) or f"http_{response.status_code}", http_status=response.status_code)
        return IceaRemoteResponse(status_code=response.status_code, body_json=body_json)

    def _get_access_token(self) -> str:
        if self.settings.bearer_token:
            return self.settings.bearer_token
        if not self.settings.token_url:
            raise IceaPipelineConfigurationError("missing_icea_s2s_credentials")

        data = {
            "grant_type": "client_credentials",
            "client_id": self.settings.client_id,
            "client_secret": self.settings.client_secret,
        }
        if self.settings.scope:
            data["scope"] = self.settings.scope
        if self.settings.audience:
            data["audience"] = self.settings.audience

        try:
            response = httpx.post(
                self.settings.token_url,
                data=data,
                headers={"Accept": "application/json"},
                timeout=max(self.settings.timeout_ms / 1000.0, 0.1),
                verify=self.settings.verify_tls,
            )
        except httpx.HTTPError as exc:
            raise IceaPipelineTransportError(exc.__class__.__name__) from exc

        body_json = _parse_json_body(response)
        if response.status_code >= 400:
            raise IceaPipelineHTTPStatusError(
                _extract_remote_detail(body_json) or f"http_{response.status_code}",
                http_status=response.status_code,
            )
        token = body_json.get("access_token") if isinstance(body_json, dict) else None
        if not isinstance(token, str) or not token.strip():
            raise IceaPipelineConfigurationError("missing_access_token")
        return token.strip()


def _join_url(base_url: str, path: str) -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{base_url.rstrip('/')}{normalized_path}"


def _parse_json_body(response: httpx.Response) -> dict[str, Any] | list[Any] | None:
    if response.status_code == 204:
        return None
    content_type = str(response.headers.get("Content-Type") or "").lower()
    raw_text = response.text.strip()
    if not raw_text:
        return None
    if "json" not in content_type and not raw_text.startswith("{") and not raw_text.startswith("["):
        return None
    try:
        parsed = response.json()
    except ValueError:
        return None
    if isinstance(parsed, (dict, list)):
        return parsed
    return None


def _extract_remote_detail(payload: dict[str, Any] | list[Any] | None) -> str:
    if isinstance(payload, dict):
        for key in ("detail", "error", "message", "code", "status"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:255]
            if isinstance(value, (int, float)):
                return str(value)
    return ""


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
    return ""


def _extract_bundle_id(bundle: dict[str, Any], request_id: str) -> str:
    identifier = bundle.get("identifier")
    if isinstance(identifier, dict):
        value = identifier.get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    bundle_id = bundle.get("id")
    if isinstance(bundle_id, str) and bundle_id.strip():
        return bundle_id.strip()
    return request_id or "unknown"


def _extract_patient_id(bundle: dict[str, Any]) -> str:
    for entry in bundle.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        resource = entry.get("resource")
        if isinstance(resource, dict) and resource.get("resourceType") == "Patient":
            patient_id = resource.get("id")
            if isinstance(patient_id, str) and patient_id.strip():
                return patient_id.strip()
    return "unknown"

def ensure_pipeline_snapshot_from_bundle(*, bundle: dict[str, Any], request: HttpRequest) -> IceaPipelineSnapshot:
    request_id = _extract_request_id(request) or "unknown"
    bundle_id = _extract_bundle_id(bundle, request_id)
    patient_id = _extract_patient_id(bundle)
    unit_id = str(request.headers.get("X-Unit-Id") or "unknown").strip() or "unknown"
    handover_status = {
        "status": IceaPipelineSnapshot.STATUS_ACCEPTED,
        "updatedAt": timezone.now().isoformat(),
    }

    snapshot, created = IceaPipelineSnapshot.objects.get_or_create(
        request_id=request_id,
        defaults={
            "bundle_id": bundle_id,
            "patient_id": patient_id,
            "unit_id": unit_id,
            "visible_status": IceaPipelineSnapshot.STATUS_ACCEPTED,
            "last_stage": "handover",
            "stage_statuses": {"handover": handover_status},
        },
    )
    if created:
        return snapshot

    stage_statuses = dict(snapshot.stage_statuses or {})
    stage_statuses.setdefault("handover", handover_status)
    updated_fields: list[str] = []
    if snapshot.bundle_id != bundle_id and snapshot.bundle_id in {"", "unknown"}:
        snapshot.bundle_id = bundle_id
        updated_fields.append("bundle_id")
    if snapshot.patient_id != patient_id and snapshot.patient_id in {"", "unknown"}:
        snapshot.patient_id = patient_id
        updated_fields.append("patient_id")
    if snapshot.unit_id != unit_id and snapshot.unit_id in {"", "unknown"}:
        snapshot.unit_id = unit_id
        updated_fields.append("unit_id")
    if snapshot.stage_statuses != stage_statuses:
        snapshot.stage_statuses = stage_statuses
        updated_fields.append("stage_statuses")
    if updated_fields:
        updated_fields.append("updated_at")
        snapshot.save(update_fields=updated_fields)
    return snapshot


def sync_pipeline_snapshot_from_outbound_event(
    event: IceaOutboundEvent,
    *,
    source: str,
    detail: str | None = None,
) -> IceaPipelineSnapshot:
    return record_pipeline_activity(
        request_id=event.request_id,
        bundle_id=event.bundle_id,
        patient_id=event.patient_id,
        unit_id=event.unit_id,
        stage="ingest",
        action="ingest",
        status=_normalize_status(event.status),
        source=source,
        detail=detail or event.last_error,
        http_status=event.last_http_status,
        payload={
            "attempts": event.attempts,
            "nextRetryAt": event.next_retry_at.isoformat() if event.next_retry_at else None,
            "deliveredAt": event.delivered_at.isoformat() if event.delivered_at else None,
        },
    )


def record_status_refresh(
    *,
    selectors: dict[str, str],
    payload: dict[str, Any] | list[Any] | None,
    actor_sub: str = "",
    source: str = "remote-status",
) -> IceaPipelineSnapshot | None:
    snapshot = resolve_pipeline_snapshot(**selectors)
    parsed = _normalize_status_payload(payload)
    if snapshot is None:
        if not selectors.get("requestId"):
            return None
        snapshot = _ensure_snapshot_from_context(selectors)

    stage_statuses = dict(snapshot.stage_statuses or {})
    for stage_name, stage_payload in parsed["stageStatuses"].items():
        stage_statuses[stage_name] = stage_payload

    snapshot.stage_statuses = stage_statuses
    snapshot.visible_status = parsed["visibleStatus"]
    snapshot.last_stage = parsed["lastStage"]
    snapshot.last_error = parsed["detail"]
    snapshot.last_http_status = None
    if parsed["remoteRefs"]:
        snapshot.remote_refs = _merge_remote_refs(snapshot.remote_refs, parsed["remoteRefs"])
    if parsed["dashboardSummary"] is not None:
        snapshot.dashboard_summary_json = parsed["dashboardSummary"]
    if parsed["causalReport"] is not None:
        snapshot.causal_report_json = parsed["causalReport"]
    snapshot.save(
        update_fields=[
            "stage_statuses",
            "visible_status",
            "last_stage",
            "last_error",
            "last_http_status",
            "remote_refs",
            "dashboard_summary_json",
            "causal_report_json",
            "updated_at",
        ]
    )
    IceaPipelineEvent.objects.create(
        snapshot=snapshot,
        request_id=snapshot.request_id,
        bundle_id=snapshot.bundle_id,
        patient_id=snapshot.patient_id,
        unit_id=snapshot.unit_id,
        stage="status",
        action="status",
        status=parsed["visibleStatus"],
        source=source,
        actor_sub=actor_sub,
        detail=parsed["detail"],
        payload_json={
            "stageStatuses": parsed["stageStatuses"],
            "remoteRefs": parsed["remoteRefs"],
        },
    )
    return snapshot


def record_pipeline_activity(
    *,
    request_id: str,
    bundle_id: str = "",
    patient_id: str = "",
    unit_id: str = "",
    stage: str,
    status: str,
    source: str,
    action: str = "",
    actor_sub: str = "",
    detail: str | None = None,
    http_status: int | None = None,
    payload: dict[str, Any] | list[Any] | None = None,
) -> IceaPipelineSnapshot:
    snapshot = _ensure_snapshot_from_context(
        {
            "requestId": request_id,
            "bundleId": bundle_id,
            "patientId": patient_id,
            "unitId": unit_id,
        }
    )
    normalized_status = _normalize_status(status)
    stage_payload = {
        "status": normalized_status,
        "updatedAt": timezone.now().isoformat(),
        "detail": _trim(detail),
        "httpStatus": http_status,
    }
    compact_payload = _compact_payload_for_stage(stage, payload)
    if compact_payload is not None:
        stage_payload["payload"] = compact_payload

    stage_statuses = dict(snapshot.stage_statuses or {})
    stage_statuses[stage] = stage_payload
    snapshot.stage_statuses = stage_statuses
    snapshot.visible_status = normalized_status
    snapshot.last_stage = stage
    snapshot.last_error = _trim(detail)
    snapshot.last_http_status = http_status
    if compact_payload is not None:
        remote_refs = _extract_remote_refs(compact_payload)
        if remote_refs:
            snapshot.remote_refs = _merge_remote_refs(snapshot.remote_refs, remote_refs)
        if stage == "dashboard-summary":
            snapshot.dashboard_summary_json = compact_payload
        elif stage == "causal-report":
            snapshot.causal_report_json = compact_payload

    snapshot.save(
        update_fields=[
            "bundle_id",
            "patient_id",
            "unit_id",
            "stage_statuses",
            "visible_status",
            "last_stage",
            "last_error",
            "last_http_status",
            "remote_refs",
            "dashboard_summary_json",
            "causal_report_json",
            "updated_at",
        ]
    )
    IceaPipelineEvent.objects.create(
        snapshot=snapshot,
        request_id=snapshot.request_id,
        bundle_id=snapshot.bundle_id,
        patient_id=snapshot.patient_id,
        unit_id=snapshot.unit_id,
        stage=stage,
        action=action,
        status=normalized_status,
        source=source,
        actor_sub=actor_sub,
        detail=_trim(detail),
        http_status=http_status,
        payload_json=compact_payload,
    )
    return snapshot


def resolve_pipeline_snapshot(
    *,
    requestId: str = "",
    bundleId: str = "",
    patientId: str = "",
    unitId: str = "",
) -> IceaPipelineSnapshot | None:
    if not any((requestId, bundleId, patientId, unitId)):
        return None

    queryset = IceaPipelineSnapshot.objects.all()
    if requestId:
        return queryset.filter(request_id=requestId).first()
    if bundleId:
        queryset = queryset.filter(bundle_id=bundleId)
    if patientId:
        queryset = queryset.filter(patient_id=patientId)
    if unitId:
        queryset = queryset.filter(unit_id=unitId)
    return queryset.order_by("-updated_at").first()


def build_dashboard_summary(*, unit_id: str | None = None, events_limit: int = 20) -> dict[str, Any]:
    snapshots = IceaPipelineSnapshot.objects.all()
    if unit_id:
        snapshots = snapshots.filter(unit_id=unit_id)

    unit_rows = list(
        snapshots.values("unit_id")
        .annotate(
            totalHandovers=Count("id"),
            accepted=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_ACCEPTED)),
            queued=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_QUEUED)),
            running=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RUNNING)),
            delivered=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_DELIVERED)),
            succeeded=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_SUCCEEDED)),
            retry=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RETRY)),
            failed=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_FAILED)),
            lastUpdatedAt=Max("updated_at"),
        )
        .order_by("unit_id")
    )

    latest_summaries: dict[str, IceaPipelineEvent] = {}
    summary_events = IceaPipelineEvent.objects.filter(stage="dashboard-summary")
    if unit_id:
        summary_events = summary_events.filter(unit_id=unit_id)
    for event in summary_events.order_by("unit_id", "-created_at"):
        if event.unit_id and event.unit_id not in latest_summaries:
            latest_summaries[event.unit_id] = event

    units: list[dict[str, Any]] = []
    for row in unit_rows:
        cached_event = latest_summaries.get(row["unit_id"])
        units.append(
            {
                "unitId": row["unit_id"],
                "totalHandovers": row["totalHandovers"],
                "accepted": row["accepted"],
                "queued": row["queued"],
                "running": row["running"],
                "delivered": row["delivered"],
                "succeeded": row["succeeded"],
                "retry": row["retry"],
                "failed": row["failed"],
                "lastUpdatedAt": row["lastUpdatedAt"].isoformat() if row["lastUpdatedAt"] else None,
                "lastDashboardRefreshAt": cached_event.created_at.isoformat() if cached_event else None,
                "cachedSummary": cached_event.payload_json if cached_event else None,
            }
        )

    recent_events = IceaPipelineEvent.objects.all()
    if unit_id:
        recent_events = recent_events.filter(unit_id=unit_id)

    return {
        "generatedAt": timezone.now().isoformat(),
        "units": units,
        "recentEvents": [serialize_pipeline_event(event) for event in recent_events[: max(1, min(events_limit, 100))]],
    }


def serialize_pipeline_snapshot(snapshot: IceaPipelineSnapshot) -> dict[str, Any]:
    return {
        "requestId": snapshot.request_id,
        "bundleId": snapshot.bundle_id,
        "patientId": snapshot.patient_id,
        "unitId": snapshot.unit_id,
        "visibleStatus": snapshot.visible_status,
        "lastStage": snapshot.last_stage,
        "lastError": snapshot.last_error or None,
        "lastHttpStatus": snapshot.last_http_status,
        "stageStatuses": snapshot.stage_statuses or {},
        "remoteRefs": snapshot.remote_refs or {},
        "dashboardSummary": snapshot.dashboard_summary_json,
        "causalReport": snapshot.causal_report_json,
        "createdAt": snapshot.created_at.isoformat(),
        "updatedAt": snapshot.updated_at.isoformat(),
    }


def serialize_pipeline_event(event: IceaPipelineEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "requestId": event.request_id or None,
        "bundleId": event.bundle_id or None,
        "patientId": event.patient_id or None,
        "unitId": event.unit_id or None,
        "stage": event.stage,
        "action": event.action or None,
        "status": event.status,
        "source": event.source or None,
        "actorSub": event.actor_sub or None,
        "detail": event.detail or None,
        "httpStatus": event.http_status,
        "payload": event.payload_json,
        "createdAt": event.created_at.isoformat(),
    }

def _ensure_snapshot_from_context(selectors: dict[str, str]) -> IceaPipelineSnapshot:
    request_id = selectors.get("requestId") or "unknown"
    snapshot, _created = IceaPipelineSnapshot.objects.get_or_create(
        request_id=request_id,
        defaults={
            "bundle_id": selectors.get("bundleId") or request_id,
            "patient_id": selectors.get("patientId") or "unknown",
            "unit_id": selectors.get("unitId") or "unknown",
            "visible_status": IceaPipelineSnapshot.STATUS_ACCEPTED,
            "last_stage": "handover",
            "stage_statuses": {},
        },
    )
    updated_fields: list[str] = []
    for field_name, selector_key in (("bundle_id", "bundleId"), ("patient_id", "patientId"), ("unit_id", "unitId")):
        selector_value = selectors.get(selector_key) or ""
        if selector_value and getattr(snapshot, field_name) in {"", "unknown"}:
            setattr(snapshot, field_name, selector_value)
            updated_fields.append(field_name)
    if updated_fields:
        updated_fields.append("updated_at")
        snapshot.save(update_fields=updated_fields)
    return snapshot


def _normalize_status(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    return STATUS_ALIASES.get(raw, raw or IceaPipelineSnapshot.STATUS_EMPTY)


def _trim(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()[:255]
    if value is None:
        return ""
    return str(value)[:255]


def _compact_payload_for_stage(stage: str, payload: dict[str, Any] | list[Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    allowed = {key: payload[key] for key in REMOTE_REF_KEYS if key in payload}
    for key in ("status", "state", "detail", "message", "generatedAt", "updatedAt", "available"):
        if key in payload:
            allowed[key] = payload[key]
    if stage == "dashboard-summary":
        summary_payload = payload.get("summary") if isinstance(payload.get("summary"), dict) else payload
        compact_summary = {}
        for key in ("unitId", "totals", "counts", "metrics", "generatedAt", "updatedAt", "status"):
            if key in summary_payload:
                compact_summary[key] = summary_payload[key]
        if compact_summary:
            allowed["summary"] = compact_summary
    if stage == "causal-report":
        report_payload = payload.get("report") if isinstance(payload.get("report"), dict) else payload
        compact_report = {}
        for key in ("reportId", "status", "available", "generatedAt", "updatedAt", "summary"):
            if key in report_payload:
                compact_report[key] = report_payload[key]
        if compact_report:
            allowed["report"] = compact_report
    return allowed or None


def _extract_remote_refs(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    return {key: payload[key] for key in REMOTE_REF_KEYS if key in payload}


def _merge_remote_refs(current: Any, incoming: dict[str, Any]) -> dict[str, Any]:
    base = dict(current) if isinstance(current, dict) else {}
    for key, value in incoming.items():
        if value is not None and value != "":
            base[key] = value
    return base


def _normalize_status_payload(payload: dict[str, Any] | list[Any] | None) -> dict[str, Any]:
    stage_statuses: dict[str, Any] = {}
    visible_status = IceaPipelineSnapshot.STATUS_EMPTY
    last_stage = "status"
    detail = ""
    remote_refs = _extract_remote_refs(payload) if isinstance(payload, dict) else {}
    dashboard_summary = None
    causal_report = None

    if isinstance(payload, dict):
        top_level_status = _extract_status_from_mapping(payload)
        if top_level_status:
            visible_status = top_level_status

        raw_stages = payload.get("stages")
        if isinstance(raw_stages, dict):
            for raw_key, raw_value in raw_stages.items():
                stage_name = STAGE_KEY_ALIASES.get(str(raw_key).strip().lower())
                if not stage_name:
                    continue
                stage_entry = _build_stage_status_entry(raw_value)
                if stage_entry is None:
                    continue
                stage_statuses[stage_name] = stage_entry
                visible_status = stage_entry["status"]
                last_stage = stage_name
                detail = stage_entry.get("detail") or detail

        dashboard_summary = _compact_payload_for_stage("dashboard-summary", payload) if any(
            key in payload for key in ("summary", "metrics", "counts", "totals")
        ) else None
        causal_report = _compact_payload_for_stage("causal-report", payload) if any(
            key in payload for key in ("report", "available", "reportId")
        ) else None
        if not detail:
            detail = _trim(_extract_remote_detail(payload))

    return {
        "visibleStatus": visible_status,
        "lastStage": last_stage,
        "detail": detail,
        "stageStatuses": stage_statuses,
        "remoteRefs": remote_refs,
        "dashboardSummary": dashboard_summary,
        "causalReport": causal_report,
    }


def _extract_status_from_mapping(payload: dict[str, Any]) -> str | None:
    for key in ("status", "state", "pipelineStatus", "result"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _normalize_status(value)
    return None


def _build_stage_status_entry(raw_value: Any) -> dict[str, Any] | None:
    if isinstance(raw_value, str):
        return {
            "status": _normalize_status(raw_value),
            "updatedAt": timezone.now().isoformat(),
            "detail": "",
            "httpStatus": None,
        }
    if not isinstance(raw_value, dict):
        return None
    entry = {
        "status": _extract_status_from_mapping(raw_value) or IceaPipelineSnapshot.STATUS_EMPTY,
        "updatedAt": timezone.now().isoformat(),
        "detail": _trim(raw_value.get("detail") or raw_value.get("message") or raw_value.get("error")),
        "httpStatus": raw_value.get("httpStatus") if isinstance(raw_value.get("httpStatus"), int) else None,
    }
    compact_payload = _compact_payload_for_stage("status", raw_value)
    if compact_payload:
        entry["payload"] = compact_payload
    return entry

