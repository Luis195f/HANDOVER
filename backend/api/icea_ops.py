from __future__ import annotations

import math
from typing import Any

from django.db.models import Count, Max, Q
from django.utils import timezone

from backend.api.dashboard_summary import _env_bool
from backend.api.icea_bridge_service import load_icea_bridge_settings
from backend.api.icea_client import load_icea_webhook_settings
from backend.api.icea_observability import (
    classify_error_family,
    latency_ms,
    safe_bridge_request_summary,
    safe_outbox_event_summary,
    safe_pipeline_event_summary,
)
from backend.api.icea_pipeline import load_icea_pipeline_settings
from backend.api.models import IceaBridgeRequest, IceaOutboundEvent, IceaPipelineEvent, IceaPipelineSnapshot
from backend.api.pilot_control import evaluate_pilot_feature_governance


OPS_STALE_AFTER = timezone.timedelta(hours=6)
SUMMARY_FLAG = "ENABLE_ICEA_OPS_SUMMARY"
EVENTS_FLAG = "ENABLE_ICEA_OPS_EVENTS"


def _serialize_datetime(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _max_datetime(*values: Any):
    candidates = [value for value in values if value is not None]
    if not candidates:
        return None
    return max(candidates)


def _ops_admin_analytics_enabled(*, unit_id: str | None = None) -> bool:
    return bool(
        evaluate_pilot_feature_governance("admin_analytics", unit_id=unit_id)["enabled"]
    )


def ops_summary_enabled(*, unit_id: str | None = None) -> bool:
    return _env_bool(SUMMARY_FLAG, True) and _ops_admin_analytics_enabled(unit_id=unit_id)


def ops_events_enabled(*, unit_id: str | None = None) -> bool:
    return _env_bool(EVENTS_FLAG, True) and _ops_admin_analytics_enabled(unit_id=unit_id)


def _ops_flags() -> dict[str, bool]:
    pipeline_settings = load_icea_pipeline_settings()
    bridge_settings = load_icea_bridge_settings()
    webhook_settings = load_icea_webhook_settings()
    return {
        "summaryEnabled": ops_summary_enabled(),
        "eventsEnabled": ops_events_enabled(),
        "bridgeEnabled": bridge_settings.enabled,
        "bridgeStatusEnabled": bridge_settings.enabled and bridge_settings.has_remote_status,
        "remoteActionsEnabled": pipeline_settings.configured,
        "remoteStatusEnabled": pipeline_settings.configured and bool(pipeline_settings.status_path),
        "outboxEnabled": webhook_settings.enabled,
    }


def _empty_latency_summary() -> dict[str, Any]:
    return {
        "count": 0,
        "avgMs": None,
        "p95Ms": None,
        "maxMs": None,
        "lastMeasuredAt": None,
    }


def _empty_freshness_summary() -> dict[str, Any]:
    return {
        "lastOutboundAttemptAt": None,
        "lastOutboundDeliveredAt": None,
        "lastBridgeUpdatedAt": None,
        "lastBridgeReceivedAt": None,
        "lastPipelineEventAt": None,
    }


def _empty_counts_summary() -> dict[str, Any]:
    return {
        "handoversExported": 0,
        "outbox": {
            "total": 0,
            "queued": 0,
            "retry": 0,
            "delivered": 0,
            "failed": 0,
            "retries": 0,
        },
        "bridge": {
            "total": 0,
            "queued": 0,
            "sent": 0,
            "accepted": 0,
            "pending": 0,
            "scored": 0,
            "failed": 0,
            "stale": 0,
            "retries": 0,
            "provisional": 0,
            "immediate": 0,
            "enriched": 0,
            "insufficientEvidence": 0,
        },
        "pipeline": {
            "snapshots": 0,
            "running": 0,
            "retry": 0,
            "failed": 0,
            "events": 0,
        },
    }


def _disabled_payload(*, scope: str, unit_id: str | None = None) -> dict[str, Any]:
    payload = {
        "generatedAt": timezone.now().isoformat(),
        "available": False,
        "enabled": False,
        "scope": scope,
        "unitId": unit_id,
        "unavailableReason": f"icea_ops_{scope}_disabled",
        "flags": _ops_flags(),
    }
    if scope == "summary":
        payload.update(
            {
                "empty": True,
                "lastUpdatedAt": None,
                "pendingCount": 0,
                "freshness": _empty_freshness_summary(),
                "counts": _empty_counts_summary(),
                "latencies": {
                    "outboxDelivery": _empty_latency_summary(),
                    "bridgeResponse": _empty_latency_summary(),
                },
                "errors": [],
                "units": [],
            }
        )
    elif scope == "events":
        payload.update(
            {
                "count": 0,
                "results": [],
            }
        )
    elif scope == "unit":
        payload.update(
            {
                "state": "degraded",
                "lastUpdatedAt": None,
                "pendingCount": 0,
                "freshness": _empty_freshness_summary(),
                "counts": _empty_counts_summary(),
                "latencies": {
                    "outboxDelivery": _empty_latency_summary(),
                    "bridgeResponse": _empty_latency_summary(),
                },
                "errors": [],
                "shifts": [],
                "recentEvents": [],
            }
        )
    return payload


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = max(0, min(len(sorted_values) - 1, math.ceil(len(sorted_values) * percentile) - 1))
    return sorted_values[index]


def _latency_summary(values: list[int], *, last_measured_at=None) -> dict[str, Any]:
    if not values:
        return {
            "count": 0,
            "avgMs": None,
            "p95Ms": None,
            "maxMs": None,
            "lastMeasuredAt": _serialize_datetime(last_measured_at),
        }
    return {
        "count": len(values),
        "avgMs": round(sum(values) / len(values), 2),
        "p95Ms": _percentile(values, 0.95),
        "maxMs": max(values),
        "lastMeasuredAt": _serialize_datetime(last_measured_at),
    }


def _state_from_metrics(
    *,
    last_updated_at,
    pending_count: int,
    failed_count: int,
    stale_count: int,
    degraded_count: int,
) -> str:
    if failed_count > 0:
        return "failed"
    if stale_count > 0 or (last_updated_at is not None and last_updated_at < timezone.now() - OPS_STALE_AFTER):
        return "stale"
    if degraded_count > 0:
        return "degraded"
    if pending_count > 0:
        return "backlog"
    return "healthy"


def _aggregate_error_rows(*, queryset, source: str, timestamp_field: str, detail_field: str, http_status_field: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in queryset.values(detail_field, http_status_field).annotate(
        count=Count("id"),
        lastSeenAt=Max(timestamp_field),
    ):
        family = classify_error_family(
            detail=row.get(detail_field),
            http_status=row.get(http_status_field),
        )
        if not family:
            continue
        rows.append(
            {
                "source": source,
                "errorFamily": family,
                "count": int(row.get("count") or 0),
                "lastSeenAt": _serialize_datetime(row.get("lastSeenAt")),
            }
        )
    return rows


def _collect_events(
    *,
    unit_id: str | None = None,
    authorized_unit_ids: set[str] | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    safe_events: list[tuple[Any, dict[str, Any]]] = []

    outbox = IceaOutboundEvent.objects.all()
    bridge = IceaBridgeRequest.objects.all()
    pipeline = IceaPipelineEvent.objects.all()
    if unit_id:
        outbox = outbox.filter(unit_id=unit_id)
        bridge = bridge.filter(unit_id=unit_id)
        pipeline = pipeline.filter(unit_id=unit_id)
    elif authorized_unit_ids is not None:
        allowed_units = sorted(authorized_unit_ids)
        outbox = outbox.filter(unit_id__in=allowed_units)
        bridge = bridge.filter(unit_id__in=allowed_units)
        pipeline = pipeline.filter(unit_id__in=allowed_units)

    for event in outbox.order_by("-created_at", "-id")[: limit * 2]:
        safe_events.append((event.delivered_at or event.last_attempt_at or event.next_retry_at or event.created_at, safe_outbox_event_summary(event)))
    for request in bridge.order_by("-updated_at", "-id")[: limit * 2]:
        safe_events.append((request.updated_at, safe_bridge_request_summary(request)))
    for event in pipeline.order_by("-created_at", "-id")[: limit * 2]:
        safe_events.append((event.created_at, safe_pipeline_event_summary(event)))

    safe_events.sort(
        key=lambda item: (
            item[0] or timezone.datetime.min.replace(tzinfo=timezone.utc),
            item[1].get("eventId") or "",
        ),
        reverse=True,
    )
    return [payload for _ts, payload in safe_events[:limit]]


def build_icea_ops_events_payload(
    *,
    unit_id: str | None = None,
    authorized_unit_ids: set[str] | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    if not ops_events_enabled(unit_id=unit_id):
        return _disabled_payload(scope="events", unit_id=unit_id)
    safe_events = _collect_events(
        unit_id=unit_id,
        authorized_unit_ids=authorized_unit_ids,
        limit=max(1, min(limit, 100)),
    )
    return {
        "generatedAt": timezone.now().isoformat(),
        "available": True,
        "enabled": True,
        "scope": "events",
        "unitId": unit_id,
        "count": len(safe_events),
        "results": safe_events,
    }


def _unit_payload(*, unit_id: str, include_recent_events: bool) -> dict[str, Any]:
    outbox = IceaOutboundEvent.objects.filter(unit_id=unit_id)
    bridge = IceaBridgeRequest.objects.filter(unit_id=unit_id)
    snapshots = IceaPipelineSnapshot.objects.filter(unit_id=unit_id)
    pipeline_events = IceaPipelineEvent.objects.filter(unit_id=unit_id)

    outbox_counts = outbox.aggregate(
        total=Count("id"),
        queued=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_QUEUED)),
        retry=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_RETRY)),
        delivered=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_DELIVERED)),
        failed=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_FAILED)),
        retries=Count("id", filter=Q(attempts__gt=1)),
        lastAttemptAt=Max("last_attempt_at"),
        lastDeliveredAt=Max("delivered_at"),
        lastCreatedAt=Max("created_at"),
    )
    bridge_counts = bridge.aggregate(
        total=Count("id"),
        queued=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_QUEUED)),
        sent=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SENT)),
        accepted=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_ACCEPTED)),
        pending=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_PENDING)),
        scored=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SCORED)),
        failed=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_FAILED)),
        stale=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_STALE)),
        retries=Count("id", filter=Q(attempts__gt=1)),
        provisional=Count("id", filter=Q(provisional=True)),
        immediate=Count("id", filter=Q(scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE)),
        enriched=Count("id", filter=Q(scoring_mode=IceaBridgeRequest.SCORING_MODE_ENRICHED)),
        insufficientEvidence=Count("id", filter=Q(insufficient_evidence=True)),
        lastUpdatedAt=Max("updated_at"),
        lastReceivedAt=Max("received_at"),
    )
    snapshot_counts = snapshots.aggregate(
        total=Count("id"),
        running=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RUNNING)),
        retry=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RETRY)),
        failed=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_FAILED)),
        lastUpdatedAt=Max("updated_at"),
    )
    pipeline_event_counts = pipeline_events.aggregate(
        total=Count("id"),
        lastEventAt=Max("created_at"),
    )

    outbox_latencies = [
        sample
        for sample in (
            latency_ms(started_at=last_attempt_at, finished_at=delivered_at)
            for last_attempt_at, delivered_at in outbox.values_list("last_attempt_at", "delivered_at")
        )
        if sample is not None
    ]
    bridge_latencies = [
        sample
        for sample in (
            latency_ms(started_at=sent_at, finished_at=received_at)
            for sent_at, received_at in bridge.values_list("sent_at", "received_at")
        )
        if sample is not None
    ]

    last_updated_at = _max_datetime(
        outbox_counts.get("lastAttemptAt"),
        outbox_counts.get("lastDeliveredAt"),
        outbox_counts.get("lastCreatedAt"),
        bridge_counts.get("lastUpdatedAt"),
        snapshot_counts.get("lastUpdatedAt"),
        pipeline_event_counts.get("lastEventAt"),
    )
    pending_count = (
        int(outbox_counts.get("queued") or 0)
        + int(outbox_counts.get("retry") or 0)
        + int(bridge_counts.get("queued") or 0)
        + int(bridge_counts.get("sent") or 0)
        + int(bridge_counts.get("accepted") or 0)
        + int(bridge_counts.get("pending") or 0)
        + int(snapshot_counts.get("running") or 0)
        + int(snapshot_counts.get("retry") or 0)
    )
    failed_count = int(outbox_counts.get("failed") or 0) + int(bridge_counts.get("failed") or 0) + int(snapshot_counts.get("failed") or 0)
    stale_count = int(bridge_counts.get("stale") or 0)
    degraded_count = int(outbox_counts.get("retry") or 0) + int(snapshot_counts.get("retry") or 0) + int(bridge_counts.get("insufficientEvidence") or 0)

    shift_rows = list(
        bridge.exclude(shift="").values("shift").annotate(
            pending=Count(
                "id",
                filter=Q(
                    status__in=[
                        IceaBridgeRequest.STATUS_QUEUED,
                        IceaBridgeRequest.STATUS_SENT,
                        IceaBridgeRequest.STATUS_ACCEPTED,
                        IceaBridgeRequest.STATUS_PENDING,
                    ]
                ),
            ),
            failed=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_FAILED)),
            stale=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_STALE)),
            lastUpdatedAt=Max("updated_at"),
        )
    )

    payload = {
        "unitId": unit_id,
        "available": any(
            int(source.get("total") or 0) > 0
            for source in (outbox_counts, bridge_counts, snapshot_counts, pipeline_event_counts)
        ),
        "state": _state_from_metrics(
            last_updated_at=last_updated_at,
            pending_count=pending_count,
            failed_count=failed_count,
            stale_count=stale_count,
            degraded_count=degraded_count,
        ),
        "lastUpdatedAt": _serialize_datetime(last_updated_at),
        "pendingCount": pending_count,
        "freshness": {
            "lastOutboundAttemptAt": _serialize_datetime(outbox_counts.get("lastAttemptAt")),
            "lastOutboundDeliveredAt": _serialize_datetime(outbox_counts.get("lastDeliveredAt")),
            "lastBridgeUpdatedAt": _serialize_datetime(bridge_counts.get("lastUpdatedAt")),
            "lastBridgeReceivedAt": _serialize_datetime(bridge_counts.get("lastReceivedAt")),
            "lastPipelineEventAt": _serialize_datetime(pipeline_event_counts.get("lastEventAt")),
        },
        "counts": {
            "handoversExported": int(outbox_counts.get("total") or 0),
            "outbox": {
                "total": int(outbox_counts.get("total") or 0),
                "queued": int(outbox_counts.get("queued") or 0),
                "retry": int(outbox_counts.get("retry") or 0),
                "delivered": int(outbox_counts.get("delivered") or 0),
                "failed": int(outbox_counts.get("failed") or 0),
                "retries": int(outbox_counts.get("retries") or 0),
            },
            "bridge": {
                "total": int(bridge_counts.get("total") or 0),
                "queued": int(bridge_counts.get("queued") or 0),
                "sent": int(bridge_counts.get("sent") or 0),
                "accepted": int(bridge_counts.get("accepted") or 0),
                "pending": int(bridge_counts.get("pending") or 0),
                "scored": int(bridge_counts.get("scored") or 0),
                "failed": int(bridge_counts.get("failed") or 0),
                "stale": int(bridge_counts.get("stale") or 0),
                "retries": int(bridge_counts.get("retries") or 0),
                "provisional": int(bridge_counts.get("provisional") or 0),
                "immediate": int(bridge_counts.get("immediate") or 0),
                "enriched": int(bridge_counts.get("enriched") or 0),
                "insufficientEvidence": int(bridge_counts.get("insufficientEvidence") or 0),
            },
            "pipeline": {
                "snapshots": int(snapshot_counts.get("total") or 0),
                "running": int(snapshot_counts.get("running") or 0),
                "retry": int(snapshot_counts.get("retry") or 0),
                "failed": int(snapshot_counts.get("failed") or 0),
                "events": int(pipeline_event_counts.get("total") or 0),
            },
        },
        "latencies": {
            "outboxDelivery": _latency_summary(outbox_latencies, last_measured_at=outbox_counts.get("lastDeliveredAt")),
            "bridgeResponse": _latency_summary(bridge_latencies, last_measured_at=bridge_counts.get("lastReceivedAt")),
        },
        "errors": sorted(
            [
                *_aggregate_error_rows(
                    queryset=outbox.exclude(last_error=""),
                    source="outbox",
                    timestamp_field="created_at",
                    detail_field="last_error",
                    http_status_field="last_http_status",
                ),
                *_aggregate_error_rows(
                    queryset=bridge.exclude(last_error=""),
                    source="bridge",
                    timestamp_field="updated_at",
                    detail_field="last_error",
                    http_status_field="last_http_status",
                ),
                *_aggregate_error_rows(
                    queryset=pipeline_events.exclude(detail=""),
                    source="pipeline",
                    timestamp_field="created_at",
                    detail_field="detail",
                    http_status_field="http_status",
                ),
            ],
            key=lambda item: (item["count"], item["source"], item["errorFamily"]),
            reverse=True,
        ),
        "shifts": [
            {
                "shift": str(row.get("shift") or ""),
                "state": _state_from_metrics(
                    last_updated_at=row.get("lastUpdatedAt"),
                    pending_count=int(row.get("pending") or 0),
                    failed_count=int(row.get("failed") or 0),
                    stale_count=int(row.get("stale") or 0),
                    degraded_count=0,
                ),
                "pendingCount": int(row.get("pending") or 0),
                "lastUpdatedAt": _serialize_datetime(row.get("lastUpdatedAt")),
            }
            for row in shift_rows
            if str(row.get("shift") or "").strip()
        ],
    }
    if include_recent_events:
        payload["recentEvents"] = _collect_events(unit_id=unit_id, limit=10)
    if not payload["available"]:
        payload["state"] = "degraded"
        payload["unavailableReason"] = "icea_ops_unit_no_data"
    return payload


def build_icea_ops_unit_payload(*, unit_id: str) -> dict[str, Any]:
    if not ops_summary_enabled(unit_id=unit_id):
        return _disabled_payload(scope="unit", unit_id=unit_id)
    payload = _unit_payload(unit_id=unit_id, include_recent_events=True)
    payload.update(
        {
            "generatedAt": timezone.now().isoformat(),
            "enabled": True,
            "scope": "unit",
        }
    )
    return payload


def build_icea_ops_summary_payload(*, authorized_unit_ids: set[str] | None = None) -> dict[str, Any]:
    if not ops_summary_enabled():
        return _disabled_payload(scope="summary")

    outbox = IceaOutboundEvent.objects.all()
    bridge = IceaBridgeRequest.objects.all()
    snapshots = IceaPipelineSnapshot.objects.all()
    pipeline_events = IceaPipelineEvent.objects.all()
    if authorized_unit_ids is not None:
        allowed_units = sorted(authorized_unit_ids)
        outbox = outbox.filter(unit_id__in=allowed_units)
        bridge = bridge.filter(unit_id__in=allowed_units)
        snapshots = snapshots.filter(unit_id__in=allowed_units)
        pipeline_events = pipeline_events.filter(unit_id__in=allowed_units)

    unit_ids = sorted(
        {
            unit_id
            for unit_id in (
                list(outbox.values_list("unit_id", flat=True))
                + list(bridge.values_list("unit_id", flat=True))
                + list(snapshots.values_list("unit_id", flat=True))
                + list(pipeline_events.values_list("unit_id", flat=True))
            )
            if isinstance(unit_id, str) and unit_id.strip()
        }
    )
    units = [_unit_payload(unit_id=unit_id, include_recent_events=False) for unit_id in unit_ids]

    outbox_counts = outbox.aggregate(
        total=Count("id"),
        queued=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_QUEUED)),
        retry=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_RETRY)),
        delivered=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_DELIVERED)),
        failed=Count("id", filter=Q(status=IceaOutboundEvent.STATUS_FAILED)),
        retries=Count("id", filter=Q(attempts__gt=1)),
        lastAttemptAt=Max("last_attempt_at"),
        lastDeliveredAt=Max("delivered_at"),
    )
    bridge_counts = bridge.aggregate(
        total=Count("id"),
        queued=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_QUEUED)),
        sent=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SENT)),
        accepted=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_ACCEPTED)),
        pending=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_PENDING)),
        scored=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_SCORED)),
        failed=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_FAILED)),
        stale=Count("id", filter=Q(status=IceaBridgeRequest.STATUS_STALE)),
        retries=Count("id", filter=Q(attempts__gt=1)),
        provisional=Count("id", filter=Q(provisional=True)),
        immediate=Count("id", filter=Q(scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE)),
        enriched=Count("id", filter=Q(scoring_mode=IceaBridgeRequest.SCORING_MODE_ENRICHED)),
        insufficientEvidence=Count("id", filter=Q(insufficient_evidence=True)),
        lastUpdatedAt=Max("updated_at"),
        lastReceivedAt=Max("received_at"),
    )
    snapshot_counts = snapshots.aggregate(
        total=Count("id"),
        running=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RUNNING)),
        retry=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_RETRY)),
        failed=Count("id", filter=Q(visible_status=IceaPipelineSnapshot.STATUS_FAILED)),
        lastUpdatedAt=Max("updated_at"),
    )
    pipeline_event_counts = pipeline_events.aggregate(
        total=Count("id"),
        lastEventAt=Max("created_at"),
    )

    outbox_latencies = [
        sample
        for sample in (
            latency_ms(started_at=last_attempt_at, finished_at=delivered_at)
            for last_attempt_at, delivered_at in outbox.values_list("last_attempt_at", "delivered_at")
        )
        if sample is not None
    ]
    bridge_latencies = [
        sample
        for sample in (
            latency_ms(started_at=sent_at, finished_at=received_at)
            for sent_at, received_at in bridge.values_list("sent_at", "received_at")
        )
        if sample is not None
    ]
    last_updated_at = _max_datetime(
        outbox_counts.get("lastAttemptAt"),
        outbox_counts.get("lastDeliveredAt"),
        bridge_counts.get("lastUpdatedAt"),
        bridge_counts.get("lastReceivedAt"),
        snapshot_counts.get("lastUpdatedAt"),
        pipeline_event_counts.get("lastEventAt"),
    )

    pending_count = sum(int(unit.get("pendingCount") or 0) for unit in units)
    failed_count = int(outbox_counts.get("failed") or 0) + int(bridge_counts.get("failed") or 0) + int(snapshot_counts.get("failed") or 0)
    stale_count = int(bridge_counts.get("stale") or 0)
    degraded_count = int(outbox_counts.get("retry") or 0) + int(snapshot_counts.get("retry") or 0) + int(bridge_counts.get("insufficientEvidence") or 0)

    errors = sorted(
        [
            *_aggregate_error_rows(
                queryset=outbox.exclude(last_error=""),
                source="outbox",
                timestamp_field="created_at",
                detail_field="last_error",
                http_status_field="last_http_status",
            ),
            *_aggregate_error_rows(
                queryset=bridge.exclude(last_error=""),
                source="bridge",
                timestamp_field="updated_at",
                detail_field="last_error",
                http_status_field="last_http_status",
            ),
            *_aggregate_error_rows(
                queryset=pipeline_events.exclude(detail=""),
                source="pipeline",
                timestamp_field="created_at",
                detail_field="detail",
                http_status_field="http_status",
            ),
        ],
        key=lambda item: (item["count"], item["source"], item["errorFamily"]),
        reverse=True,
    )

    return {
        "generatedAt": timezone.now().isoformat(),
        "available": True,
        "enabled": True,
        "scope": "summary",
        "empty": not units and int(outbox_counts.get("total") or 0) == 0 and int(bridge_counts.get("total") or 0) == 0 and int(snapshot_counts.get("total") or 0) == 0,
        "state": _state_from_metrics(
            last_updated_at=last_updated_at,
            pending_count=pending_count,
            failed_count=failed_count,
            stale_count=stale_count,
            degraded_count=degraded_count,
        ),
        "lastUpdatedAt": _serialize_datetime(last_updated_at),
        "pendingCount": pending_count,
        "flags": _ops_flags(),
        "freshness": {
            "lastOutboundAttemptAt": _serialize_datetime(outbox_counts.get("lastAttemptAt")),
            "lastOutboundDeliveredAt": _serialize_datetime(outbox_counts.get("lastDeliveredAt")),
            "lastBridgeUpdatedAt": _serialize_datetime(bridge_counts.get("lastUpdatedAt")),
            "lastBridgeReceivedAt": _serialize_datetime(bridge_counts.get("lastReceivedAt")),
            "lastPipelineEventAt": _serialize_datetime(pipeline_event_counts.get("lastEventAt")),
        },
        "counts": {
            "handoversExported": int(outbox_counts.get("total") or 0),
            "outbox": {
                "total": int(outbox_counts.get("total") or 0),
                "queued": int(outbox_counts.get("queued") or 0),
                "retry": int(outbox_counts.get("retry") or 0),
                "delivered": int(outbox_counts.get("delivered") or 0),
                "failed": int(outbox_counts.get("failed") or 0),
                "retries": int(outbox_counts.get("retries") or 0),
            },
            "bridge": {
                "total": int(bridge_counts.get("total") or 0),
                "queued": int(bridge_counts.get("queued") or 0),
                "sent": int(bridge_counts.get("sent") or 0),
                "accepted": int(bridge_counts.get("accepted") or 0),
                "pending": int(bridge_counts.get("pending") or 0),
                "scored": int(bridge_counts.get("scored") or 0),
                "failed": int(bridge_counts.get("failed") or 0),
                "stale": int(bridge_counts.get("stale") or 0),
                "retries": int(bridge_counts.get("retries") or 0),
                "provisional": int(bridge_counts.get("provisional") or 0),
                "immediate": int(bridge_counts.get("immediate") or 0),
                "enriched": int(bridge_counts.get("enriched") or 0),
                "insufficientEvidence": int(bridge_counts.get("insufficientEvidence") or 0),
            },
            "pipeline": {
                "snapshots": int(snapshot_counts.get("total") or 0),
                "running": int(snapshot_counts.get("running") or 0),
                "retry": int(snapshot_counts.get("retry") or 0),
                "failed": int(snapshot_counts.get("failed") or 0),
                "events": int(pipeline_event_counts.get("total") or 0),
            },
        },
        "latencies": {
            "outboxDelivery": _latency_summary(outbox_latencies, last_measured_at=outbox_counts.get("lastDeliveredAt")),
            "bridgeResponse": _latency_summary(bridge_latencies, last_measured_at=bridge_counts.get("lastReceivedAt")),
        },
        "errors": errors,
        "units": units,
    }
