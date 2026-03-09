from __future__ import annotations

import math
import os
import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from django.db.models import Count, Max, Q
from django.utils import timezone

from backend.api.icea_client import load_icea_webhook_settings
from backend.api.models import (
    HandoverBundleRecord,
    IceaBridgeRequest,
    IceaOutboundEvent,
    IceaPipelineEvent,
    IceaPipelineSnapshot,
)
from backend.audit.models import AuditEvent

DASHBOARD_STALE_AFTER = timezone.timedelta(hours=6)
TIMING_ALLOWED_SECTIONS = frozenset({"sbar", "vitals", "diagnostics", "treatments"})


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _is_valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def _serialize_datetime(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _max_datetimes(*values: Any) -> Any:
    normalized = [value for value in values if value is not None]
    if not normalized:
        return None
    return max(normalized)


def _max_row_value(rows: list[dict[str, Any]], key: str) -> Any:
    return _max_datetimes(*(row.get(key) for row in rows))


def _normalize_timing_section_id(value: Any) -> str:
    section_id = str(value or "").strip().lower()
    for _ in range(5):
        previous = section_id
        if len(section_id) >= 2 and section_id[0] == '"' and section_id[-1] == '"':
            section_id = section_id[1:-1].strip()
            continue
        if section_id.startswith('\\"') and section_id.endswith('\\"') and len(section_id) >= 4:
            section_id = section_id[2:-2].strip()
            continue
        if section_id == previous:
            break
    return section_id


def _parse_timing_duration_ms(value: Any) -> float | None:
    if value is None:
        return None
    try:
        duration_ms = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(duration_ms) or duration_ms < 0:
        return None
    return duration_ms


def _build_dashboard_timing_summary(*, timing_events, unit_filter: str | None) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], dict[str, float | int]] = defaultdict(lambda: {"total": 0.0, "samples": 0})
    for meta in timing_events.values_list("meta", flat=True):
        timing = meta.get("timing") if isinstance(meta, dict) else None
        if not isinstance(timing, dict):
            continue
        raw_unit = str(timing.get("unitId") or "").strip() or "unknown"
        if unit_filter and raw_unit != unit_filter:
            continue
        section_id = _normalize_timing_section_id(timing.get("sectionId"))
        if section_id not in TIMING_ALLOWED_SECTIONS:
            continue
        duration_ms = _parse_timing_duration_ms(timing.get("durationMs"))
        if duration_ms is None:
            continue
        key = (raw_unit, section_id)
        grouped[key]["total"] += duration_ms
        grouped[key]["samples"] += 1

    rows_by_unit: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (raw_unit, section_id), stats in grouped.items():
        samples = int(stats["samples"])
        if samples <= 0:
            continue
        rows_by_unit[raw_unit].append(
            {
                "unitId": raw_unit,
                "sectionId": section_id,
                "avgDurationMs": round(float(stats["total"]) / samples, 2),
                "samples": samples,
            }
        )

    for unit_key in list(rows_by_unit.keys()):
        rows_by_unit[unit_key].sort(key=lambda row: (str(row["sectionId"]), str(row["unitId"])))
    return dict(rows_by_unit)


def _bridge_alert_message(request: IceaBridgeRequest) -> str:
    if request.insufficient_evidence:
        return "ICEA+ devolvio scoring provisional con evidencia insuficiente."
    if request.status == IceaBridgeRequest.STATUS_STALE:
        return "El ultimo scoring ICEA+ quedo stale y requiere refresh o reintento."
    return f"ICEA+ bridge en estado {request.status}."


def _build_dashboard_alerts(*, snapshots, outbox, bridge) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []

    for event in outbox.filter(status__in=[IceaOutboundEvent.STATUS_RETRY, IceaOutboundEvent.STATUS_FAILED]).order_by("-created_at")[:6]:
        alerts.append(
            {
                "id": f"outbox-{event.id}",
                "unitId": event.unit_id or None,
                "source": "outbox",
                "severity": "high" if event.status == IceaOutboundEvent.STATUS_FAILED else "medium",
                "status": event.status,
                "title": "Entrega ICEA con incidencia",
                "message": (event.last_error or f"Outbox ICEA en estado {event.status}.")[:255],
                "requestId": event.request_id,
                "createdAt": event.created_at.isoformat(),
            }
        )

    bridge_filter = Q(status__in=[IceaBridgeRequest.STATUS_FAILED, IceaBridgeRequest.STATUS_STALE]) | Q(insufficient_evidence=True)
    for request in bridge.filter(bridge_filter).order_by("-updated_at")[:6]:
        if request.status == IceaBridgeRequest.STATUS_FAILED:
            severity = "high"
            title = "Score ICEA fallido"
        elif request.status == IceaBridgeRequest.STATUS_STALE:
            severity = "medium"
            title = "Score ICEA desactualizado"
        else:
            severity = "medium"
            title = "Score ICEA con evidencia insuficiente"
        alerts.append(
            {
                "id": f"bridge-{request.id}",
                "unitId": request.unit_id or None,
                "source": "bridge",
                "severity": severity,
                "status": request.status,
                "title": title,
                "message": (request.last_error or _bridge_alert_message(request))[:255],
                "requestId": request.request_id,
                "createdAt": request.updated_at.isoformat(),
            }
        )

    for snapshot in snapshots.filter(visible_status__in=[IceaPipelineSnapshot.STATUS_RETRY, IceaPipelineSnapshot.STATUS_FAILED]).order_by("-updated_at")[:6]:
        alerts.append(
            {
                "id": f"snapshot-{snapshot.request_id}",
                "unitId": snapshot.unit_id or None,
                "source": "pipeline",
                "severity": "high" if snapshot.visible_status == IceaPipelineSnapshot.STATUS_FAILED else "medium",
                "status": snapshot.visible_status,
                "title": "Pipeline ICEA degradado",
                "message": (snapshot.last_error or f"Pipeline en etapa {snapshot.last_stage} con estado {snapshot.visible_status}.")[:255],
                "requestId": snapshot.request_id,
                "createdAt": snapshot.updated_at.isoformat(),
            }
        )

    alerts.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return alerts[:10]


def _resolve_unit_operational_status(
    *,
    total_handovers: int,
    queued: int,
    running: int,
    retry: int,
    failed: int,
    outbox_retry: int,
    outbox_failed: int,
    bridge_pending: int,
    bridge_failed: int,
) -> str:
    if failed > 0 or outbox_failed > 0 or bridge_failed > 0:
        return "degraded"
    if retry > 0 or outbox_retry > 0:
        return "attention"
    if queued > 0 or running > 0 or bridge_pending > 0:
        return "active"
    if total_handovers > 0:
        return "nominal"
    return "empty"


def build_dashboard_summary_payload(
    *,
    unit_id: str | None,
    events_limit: int,
    serialize_pipeline_event: Callable[[IceaPipelineEvent], dict[str, Any]],
    load_pipeline_settings: Callable[[], Any],
) -> dict[str, Any]:
    now = timezone.now()
    recent_cutoff = now - timezone.timedelta(hours=24)

    snapshots = IceaPipelineSnapshot.objects.all()
    records = HandoverBundleRecord.objects.all()
    events = IceaPipelineEvent.objects.all()
    outbox = IceaOutboundEvent.objects.all()
    bridge = IceaBridgeRequest.objects.all()
    timing_events = AuditEvent.objects.filter(event_type="handover_timing")

    if unit_id:
        snapshots = snapshots.filter(unit_id=unit_id)
        records = records.filter(unit_id=unit_id)
        events = events.filter(unit_id=unit_id)
        outbox = outbox.filter(unit_id=unit_id)
        bridge = bridge.filter(unit_id=unit_id)

    record_rows = list(
        records.values("unit_id")
        .annotate(
            totalHandovers=Count("id"),
            handoversLast24h=Count("id", filter=Q(created_at__gte=recent_cutoff)),
            lastHandoverAt=Max("created_at"),
        )
        .order_by("unit_id")
    )
    snapshot_rows = list(
        snapshots.values("unit_id")
        .annotate(
            snapshotTotal=Count("id"),
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
    event_rows = list(
        events.values("unit_id")
        .annotate(
            eventsLast24h=Count("id", filter=Q(created_at__gte=recent_cutoff)),
            lastEventAt=Max("created_at"),
        )
        .order_by("unit_id")
    )
    outbox_rows = list(
        outbox.values("unit_id")
        .annotate(
            queued=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_QUEUED)),
            retry=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_RETRY)),
            delivered=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_DELIVERED)),
            failed=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_FAILED)),
            total=Count("id"),
            lastAttemptAt=Max("last_attempt_at"),
            lastDeliveredAt=Max("delivered_at"),
            lastCreatedAt=Max("created_at"),
        )
        .order_by("unit_id")
    )
    bridge_rows = list(
        bridge.values("unit_id")
        .annotate(
            queued=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_QUEUED)),
            sent=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SENT)),
            accepted=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_ACCEPTED)),
            pending=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_PENDING)),
            scored=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SCORED)),
            failed=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_FAILED)),
            stale=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_STALE)),
            provisional=Count("id", filter=Q(provisional=True)),
            insufficientEvidence=Count("id", filter=Q(insufficient_evidence=True)),
            total=Count("id"),
            lastUpdatedAt=Max("updated_at"),
        )
        .order_by("unit_id")
    )

    latest_summaries: dict[str, IceaPipelineEvent] = {}
    for event in events.filter(stage="dashboard-summary").order_by("unit_id", "-created_at", "-id"):
        if event.unit_id and event.unit_id not in latest_summaries:
            latest_summaries[event.unit_id] = event

    timing_by_unit = _build_dashboard_timing_summary(timing_events=timing_events, unit_filter=unit_id)
    alerts = _build_dashboard_alerts(snapshots=snapshots, outbox=outbox, bridge=bridge)
    alert_counts_by_unit: dict[str, int] = defaultdict(int)
    for alert in alerts:
        alert_unit = str(alert.get("unitId") or "").strip()
        if alert_unit:
            alert_counts_by_unit[alert_unit] += 1

    record_by_unit = {str(row["unit_id"] or "").strip() or "unknown": row for row in record_rows}
    snapshot_by_unit = {str(row["unit_id"] or "").strip() or "unknown": row for row in snapshot_rows}
    event_by_unit = {str(row["unit_id"] or "").strip() or "unknown": row for row in event_rows}
    outbox_by_unit = {str(row["unit_id"] or "").strip() or "unknown": row for row in outbox_rows}
    bridge_by_unit = {str(row["unit_id"] or "").strip() or "unknown": row for row in bridge_rows}

    all_unit_ids = {
        unit_key
        for unit_key in (
            set(record_by_unit.keys())
            | set(snapshot_by_unit.keys())
            | set(event_by_unit.keys())
            | set(outbox_by_unit.keys())
            | set(bridge_by_unit.keys())
            | set(timing_by_unit.keys())
        )
        if unit_key
    }

    pipeline_settings = load_pipeline_settings()
    webhook_settings = load_icea_webhook_settings()
    bridge_enabled = _env_bool("ENABLE_ICEA_BRIDGE", False)
    bridge_model_id = (os.getenv("ICEA_BRIDGE_MODEL_ID") or "").strip()
    bridge_model_valid = _is_valid_uuid(bridge_model_id)
    bridge_configured = bridge_enabled and pipeline_settings.configured and bridge_model_valid

    units: list[dict[str, Any]] = []
    latest_activity_candidates: list[Any] = []
    for unit_key in sorted(all_unit_ids):
        record_row = record_by_unit.get(unit_key, {})
        snapshot_row = snapshot_by_unit.get(unit_key, {})
        event_row = event_by_unit.get(unit_key, {})
        outbox_row = outbox_by_unit.get(unit_key, {})
        bridge_row = bridge_by_unit.get(unit_key, {})
        cached_event = latest_summaries.get(unit_key)

        total_handovers = int(record_row.get("totalHandovers") or 0)
        snapshot_total = int(snapshot_row.get("snapshotTotal") or 0)
        queued = int(snapshot_row.get("queued") or 0)
        running = int(snapshot_row.get("running") or 0)
        delivered = int(snapshot_row.get("delivered") or 0)
        succeeded = int(snapshot_row.get("succeeded") or 0)
        retry = int(snapshot_row.get("retry") or 0)
        failed = int(snapshot_row.get("failed") or 0)
        explicit_accepted = int(snapshot_row.get("accepted") or 0)
        accepted = max(total_handovers - (queued + running + delivered + succeeded + retry + failed), explicit_accepted)
        if snapshot_total == 0 and total_handovers > 0:
            accepted = total_handovers

        last_activity_at = _max_datetimes(
            record_row.get("lastHandoverAt"),
            snapshot_row.get("lastUpdatedAt"),
            event_row.get("lastEventAt"),
            outbox_row.get("lastAttemptAt"),
            outbox_row.get("lastDeliveredAt"),
            outbox_row.get("lastCreatedAt"),
            bridge_row.get("lastUpdatedAt"),
        )
        if last_activity_at is not None:
            latest_activity_candidates.append(last_activity_at)

        outbox_summary = {
            "total": int(outbox_row.get("total") or 0),
            "queued": int(outbox_row.get("queued") or 0),
            "retry": int(outbox_row.get("retry") or 0),
            "delivered": int(outbox_row.get("delivered") or 0),
            "failed": int(outbox_row.get("failed") or 0),
            "lastAttemptAt": _serialize_datetime(outbox_row.get("lastAttemptAt")),
            "lastDeliveredAt": _serialize_datetime(outbox_row.get("lastDeliveredAt")),
        }
        bridge_summary = {
            "total": int(bridge_row.get("total") or 0),
            "queued": int(bridge_row.get("queued") or 0),
            "sent": int(bridge_row.get("sent") or 0),
            "accepted": int(bridge_row.get("accepted") or 0),
            "pending": int(bridge_row.get("pending") or 0),
            "scored": int(bridge_row.get("scored") or 0),
            "failed": int(bridge_row.get("failed") or 0),
            "stale": int(bridge_row.get("stale") or 0),
            "provisional": int(bridge_row.get("provisional") or 0),
            "insufficientEvidence": int(bridge_row.get("insufficientEvidence") or 0),
            "lastUpdatedAt": _serialize_datetime(bridge_row.get("lastUpdatedAt")),
        }

        unit_degradation_reasons: list[str] = []
        if outbox_summary["failed"] > 0:
            unit_degradation_reasons.append("outbox_failed")
        if outbox_summary["retry"] > 0:
            unit_degradation_reasons.append("outbox_retry")
        if failed > 0:
            unit_degradation_reasons.append("pipeline_failed")
        if retry > 0:
            unit_degradation_reasons.append("pipeline_retry")
        if bridge_summary["failed"] > 0:
            unit_degradation_reasons.append("bridge_failed")
        if bridge_summary["stale"] > 0:
            unit_degradation_reasons.append("bridge_stale")
        if bridge_summary["insufficientEvidence"] > 0:
            unit_degradation_reasons.append("bridge_insufficient_evidence")
        if last_activity_at is not None and last_activity_at < now - DASHBOARD_STALE_AFTER:
            unit_degradation_reasons.append("unit_activity_stale")

        units.append(
            {
                "unitId": unit_key,
                "totalHandovers": total_handovers,
                "accepted": accepted,
                "queued": queued,
                "running": running,
                "delivered": delivered,
                "succeeded": succeeded,
                "retry": retry,
                "failed": failed,
                "lastUpdatedAt": _serialize_datetime(snapshot_row.get("lastUpdatedAt")),
                "lastDashboardRefreshAt": cached_event.created_at.isoformat() if cached_event else None,
                "cachedSummary": cached_event.payload_json if cached_event else None,
                "activity": {
                    "status": _resolve_unit_operational_status(
                        total_handovers=total_handovers,
                        queued=queued,
                        running=running,
                        retry=retry,
                        failed=failed,
                        outbox_retry=outbox_summary["retry"],
                        outbox_failed=outbox_summary["failed"],
                        bridge_pending=bridge_summary["queued"] + bridge_summary["sent"] + bridge_summary["accepted"] + bridge_summary["pending"],
                        bridge_failed=bridge_summary["failed"] + bridge_summary["stale"],
                    ),
                    "handoversLast24h": int(record_row.get("handoversLast24h") or 0),
                    "eventsLast24h": int(event_row.get("eventsLast24h") or 0),
                    "activePipeline": queued + running + retry,
                    "lastActivityAt": _serialize_datetime(last_activity_at),
                },
                "outbox": outbox_summary,
                "bridge": bridge_summary,
                "handoverTiming": timing_by_unit.get(unit_key, []),
                "alertsOpen": int(alert_counts_by_unit.get(unit_key, 0)),
                "degraded": bool(unit_degradation_reasons),
                "degradationReasons": unit_degradation_reasons,
            }
        )

    latest_activity_at = _max_datetimes(*latest_activity_candidates)
    recent_events = list(events.order_by("-created_at", "-id")[: max(1, min(events_limit, 100))])

    outbox_totals = {
        "queued": sum(int(row.get("queued") or 0) for row in outbox_rows),
        "retry": sum(int(row.get("retry") or 0) for row in outbox_rows),
        "delivered": sum(int(row.get("delivered") or 0) for row in outbox_rows),
        "failed": sum(int(row.get("failed") or 0) for row in outbox_rows),
    }
    bridge_totals = {
        "queued": sum(int(row.get("queued") or 0) for row in bridge_rows),
        "sent": sum(int(row.get("sent") or 0) for row in bridge_rows),
        "accepted": sum(int(row.get("accepted") or 0) for row in bridge_rows),
        "pending": sum(int(row.get("pending") or 0) for row in bridge_rows),
        "scored": sum(int(row.get("scored") or 0) for row in bridge_rows),
        "failed": sum(int(row.get("failed") or 0) for row in bridge_rows),
        "stale": sum(int(row.get("stale") or 0) for row in bridge_rows),
        "provisional": sum(int(row.get("provisional") or 0) for row in bridge_rows),
        "insufficientEvidence": sum(int(row.get("insufficientEvidence") or 0) for row in bridge_rows),
    }

    global_degradation_reasons = list(pipeline_settings.validation_errors)
    if webhook_settings.validation_errors:
        global_degradation_reasons.extend(webhook_settings.validation_errors)
    if bridge_enabled and not bridge_model_id:
        global_degradation_reasons.append("missing_icea_bridge_model_id")
    elif bridge_enabled and bridge_model_id and not bridge_model_valid:
        global_degradation_reasons.append("invalid_icea_bridge_model_id")
    if outbox_totals["retry"] > 0:
        global_degradation_reasons.append("outbox_retry")
    if outbox_totals["failed"] > 0:
        global_degradation_reasons.append("outbox_failed")
    if bridge_totals["failed"] > 0:
        global_degradation_reasons.append("bridge_failed")
    if bridge_totals["stale"] > 0:
        global_degradation_reasons.append("bridge_stale")

    stale = latest_activity_at is not None and latest_activity_at < now - DASHBOARD_STALE_AFTER
    if stale:
        global_degradation_reasons.append("dashboard_activity_stale")

    empty = (
        not units
        and not recent_events
        and not alerts
        and sum(outbox_totals.values()) == 0
        and sum(bridge_totals.values()) == 0
    )

    return {
        "generatedAt": now.isoformat(),
        "source": "live",
        "demoMode": False,
        "empty": empty,
        "stale": stale,
        "degraded": bool(global_degradation_reasons),
        "degradationReasons": sorted(set(global_degradation_reasons)),
        "latestActivityAt": _serialize_datetime(latest_activity_at),
        "units": units,
        "alerts": alerts,
        "outbox": {
            "enabled": webhook_settings.enabled,
            "configured": webhook_settings.configured,
            "totals": outbox_totals,
            "lastAttemptAt": _serialize_datetime(_max_row_value(outbox_rows, "lastAttemptAt")),
            "lastDeliveredAt": _serialize_datetime(_max_row_value(outbox_rows, "lastDeliveredAt")),
        },
        "pipeline": {
            "configured": pipeline_settings.configured,
            "remoteActionsEnabled": pipeline_settings.configured,
            "remoteStatusEnabled": pipeline_settings.configured and bool(pipeline_settings.status_path),
            "bridgeEnabled": bridge_enabled,
            "bridgeConfigured": bridge_configured,
            "snapshots": snapshots.count(),
            "running": sum(int(row.get("running") or 0) for row in snapshot_rows),
            "retry": sum(int(row.get("retry") or 0) for row in snapshot_rows),
            "failed": sum(int(row.get("failed") or 0) for row in snapshot_rows),
            "bridge": bridge_totals,
            "lastEventAt": _serialize_datetime(_max_row_value(event_rows, "lastEventAt")),
            "degradationReasons": sorted(set(global_degradation_reasons)),
        },
        "recentEvents": [serialize_pipeline_event(event) for event in recent_events],
    }


