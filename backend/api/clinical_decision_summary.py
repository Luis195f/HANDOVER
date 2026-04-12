from __future__ import annotations

import datetime
from collections import defaultdict
from typing import Any

from django.db.models import CharField, Count
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Lower, TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from backend.api.models import ClinicalDecisionEvent
from backend.api.pilot_control import (
    evaluate_pilot_feature_governance,
)


CLINICAL_DECISION_ALLOWED_SOURCES = frozenset(
    {
        "ai_generate_sbar",
        "ai_refine_sbar",
        "ai_nic_suggestions",
        "ai_noc_suggestions",
    }
)
CLINICAL_DECISION_ALLOWED_SECTIONS = frozenset({"sbar", "treatments", "outcomes"})
CLINICAL_DECISION_ALLOWED_DECISIONS = frozenset(
    choice for choice, _label in ClinicalDecisionEvent.DECISION_CHOICES
)


def _serialize_datetime(value: datetime.datetime | None) -> str | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return value.isoformat()


def _normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized or None


def _parse_date_bound(value: Any, *, end_of_day: bool) -> datetime.datetime | None:
    if not isinstance(value, str):
        return None
    raw_value = value.strip()
    if not raw_value:
        return None

    parsed_date = parse_date(raw_value)
    looks_like_plain_date = parsed_date is not None and "T" not in raw_value and " " not in raw_value
    if looks_like_plain_date:
        if end_of_day:
            parsed_datetime = datetime.datetime.combine(parsed_date + datetime.timedelta(days=1), datetime.time.min)
        else:
            parsed_datetime = datetime.datetime.combine(parsed_date, datetime.time.min)
        return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())

    parsed_datetime = parse_datetime(raw_value)
    if parsed_datetime is not None:
        if timezone.is_naive(parsed_datetime):
            parsed_datetime = timezone.make_aware(parsed_datetime, timezone.get_current_timezone())
        return parsed_datetime

    if parsed_date is None:
        return None

    if end_of_day:
        parsed_datetime = datetime.datetime.combine(parsed_date + datetime.timedelta(days=1), datetime.time.min)
    else:
        parsed_datetime = datetime.datetime.combine(parsed_date, datetime.time.min)
    return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())


def _disabled_payload(*, unit_id: str | None, filters: dict[str, Any], feature: dict[str, Any]) -> dict[str, Any]:
    return {
        "generatedAt": timezone.now().isoformat(),
        "available": False,
        "enabled": False,
        "scope": "clinical_decisions_summary",
        "filters": filters,
        "empty": True,
        "unavailableReason": feature["denialReason"] or "admin_analytics_disabled",
        "feature": {
            "key": feature["key"],
            "mode": feature["mode"],
            "pilotMode": feature["pilotMode"],
            "shadowMode": feature["shadowMode"],
        },
        "totals": {
            "events": 0,
            "units": 0,
            "suggestionSources": 0,
            "sections": 0,
        },
        "byDecision": [],
        "byUnit": [],
        "bySuggestionSource": [],
        "bySection": [],
        "timeline": [],
        "limitations": [
            "Lectura agregada y piloto-grade; no habilita ranking ni evaluacion individual.",
            "Mide solo decisiones registradas en superficies IA cableadas; no equivale a verdad clinica ni rendimiento profesional.",
        ],
        **({"unitId": unit_id} if unit_id else {}),
    }

def _decision_count_map(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = {decision: 0 for decision in CLINICAL_DECISION_ALLOWED_DECISIONS}
    for row in rows:
        decision = str(row.get("decision") or "").strip().lower()
        if decision in counts:
            counts[decision] = int(row.get("count") or 0)
    return counts


def _section_queryset(queryset):
    section_path = KeyTextTransform("section", "metadata")
    return queryset.annotate(section_value=Lower(Cast(section_path, output_field=CharField())))


def _timeline_payload(queryset) -> list[dict[str, Any]]:
    rows = list(
        queryset.annotate(day=TruncDate("created_at"))
        .values("day", "decision")
        .annotate(count=Count("id"))
        .order_by("day", "decision")
    )

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        day_value = row.get("day")
        if day_value is None:
            continue
        day_key = day_value.isoformat()
        bucket = grouped.setdefault(
            day_key,
            {
                "date": day_key,
                "count": 0,
                "decisions": {decision: 0 for decision in CLINICAL_DECISION_ALLOWED_DECISIONS},
            },
        )
        decision = str(row.get("decision") or "").strip().lower()
        count = int(row.get("count") or 0)
        bucket["count"] += count
        if decision in bucket["decisions"]:
            bucket["decisions"][decision] = count
    return list(grouped.values())


def _aggregate_breakdown(rows: list[dict[str, Any]], *, key_name: str, value_name: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        group_key = str(row.get(key_name) or "").strip()
        if not group_key:
            continue
        grouped[group_key].append(row)

    payload: list[dict[str, Any]] = []
    for group_key, items in grouped.items():
        decision_counts = _decision_count_map(items)
        payload.append(
            {
                value_name: group_key,
                "count": sum(decision_counts.values()),
                "decisions": decision_counts,
            }
        )

    payload.sort(key=lambda item: (-int(item["count"]), str(item[value_name])))
    return payload


def build_clinical_decision_summary_payload(
    *,
    unit_id: str | None,
    authorized_unit_ids: set[str] | None,
    suggestion_source: str | None,
    decision: str | None,
    section: str | None,
    date_from: str | None,
    date_to: str | None,
    roles: list[str] | tuple[str, ...] | set[str] | None,
) -> dict[str, Any]:
    normalized_unit_id = (unit_id or "").strip() or None
    normalized_source = _normalize_text(suggestion_source)
    normalized_decision = _normalize_text(decision)
    normalized_section = _normalize_text(section)
    parsed_from = _parse_date_bound(date_from, end_of_day=False)
    parsed_to_exclusive = _parse_date_bound(date_to, end_of_day=True)

    filters = {
        "unitId": normalized_unit_id,
        "suggestionSource": normalized_source,
        "decision": normalized_decision,
        "section": normalized_section,
        "dateFrom": date_from.strip() if isinstance(date_from, str) and date_from.strip() else None,
        "dateTo": date_to.strip() if isinstance(date_to, str) and date_to.strip() else None,
    }

    feature = evaluate_pilot_feature_governance("admin_analytics", unit_id=normalized_unit_id, roles=roles)
    if not feature["enabled"]:
        return _disabled_payload(unit_id=normalized_unit_id, filters=filters, feature=feature)

    queryset = ClinicalDecisionEvent.objects.all()
    if authorized_unit_ids is not None:
        queryset = queryset.filter(unit_id__in=sorted(authorized_unit_ids))
    if normalized_unit_id:
        queryset = queryset.filter(unit_id=normalized_unit_id)
    if normalized_source:
        queryset = queryset.filter(suggestion_source=normalized_source)
    if normalized_decision:
        queryset = queryset.filter(decision=normalized_decision)
    if parsed_from is not None:
        queryset = queryset.filter(created_at__gte=parsed_from)
    if parsed_to_exclusive is not None:
        queryset = queryset.filter(created_at__lt=parsed_to_exclusive)

    section_queryset = _section_queryset(queryset)
    if normalized_section:
        section_queryset = section_queryset.filter(section_value=normalized_section)

    total_events = section_queryset.count()
    decision_rows = list(
        section_queryset.values("decision").annotate(count=Count("id")).order_by("-count", "decision")
    )
    unit_rows = list(
        section_queryset.values("unit_id").annotate(count=Count("id")).order_by("-count", "unit_id")
    )
    source_rows = list(
        section_queryset.values("suggestion_source").annotate(count=Count("id")).order_by("-count", "suggestion_source")
    )
    section_rows = list(
        section_queryset.exclude(section_value__isnull=True)
        .exclude(section_value="")
        .values("section_value")
        .annotate(count=Count("id"))
        .order_by("-count", "section_value")
    )
    source_decision_rows = list(
        section_queryset.values("suggestion_source", "decision")
        .annotate(count=Count("id"))
        .order_by("suggestion_source", "decision")
    )
    section_decision_rows = list(
        section_queryset.exclude(section_value__isnull=True)
        .exclude(section_value="")
        .values("section_value", "decision")
        .annotate(count=Count("id"))
        .order_by("section_value", "decision")
    )

    return {
        "generatedAt": timezone.now().isoformat(),
        "available": True,
        "enabled": True,
        "scope": "clinical_decisions_summary",
        "filters": filters,
        "queryBounds": {
            "createdAtGte": _serialize_datetime(parsed_from),
            "createdAtLt": _serialize_datetime(parsed_to_exclusive),
        },
        "empty": total_events == 0,
        "feature": {
            "key": feature["key"],
            "mode": feature["mode"],
            "pilotMode": feature["pilotMode"],
            "shadowMode": feature["shadowMode"],
        },
        "totals": {
            "events": total_events,
            "units": len(unit_rows),
            "suggestionSources": len(source_rows),
            "sections": len(section_rows),
        },
        "byDecision": [
            {
                "decision": str(row["decision"]),
                "count": int(row["count"]),
            }
            for row in decision_rows
        ],
        "byUnit": [
            {
                "unitId": str(row["unit_id"]),
                "count": int(row["count"]),
            }
            for row in unit_rows
        ],
        "bySuggestionSource": _aggregate_breakdown(
            source_decision_rows,
            key_name="suggestion_source",
            value_name="suggestionSource",
        ),
        "bySection": _aggregate_breakdown(
            section_decision_rows,
            key_name="section_value",
            value_name="section",
        ),
        "timeline": _timeline_payload(section_queryset),
        "limitations": [
            "Lectura agregada y piloto-grade; no expone identificadores nominales ni admite benchmarking individual.",
            "Mide decisiones registradas sobre superficies IA ya cableadas (SBAR/NIC/NOC), no verdad clinica ni rendimiento profesional.",
        ],
    }
