from __future__ import annotations

import os
from typing import Any

from django.utils import timezone

from backend.api.icea_bridge_service import (
    expire_icea_bridge_request_if_due,
    load_icea_bridge_settings,
    materialize_icea_bridge_requests_if_due,
)
from backend.api.models import IceaBridgeRequest, IceaPipelineSnapshot
from backend.api.pilot_control import is_pilot_feature_enabled


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def icea_patient_risk_enabled() -> bool:
    return (
        _env_bool("ENABLE_ICEA_BRIDGE", False)
        and _env_bool("ENABLE_ICEA_PATIENT_RISK", False)
        and is_pilot_feature_enabled("icea_patient_risk")
    )


def icea_causal_summary_enabled() -> bool:
    return icea_patient_risk_enabled() and _env_bool("ENABLE_ICEA_CAUSAL_SUMMARY", False)


def _normalize_warnings(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, dict):
            code = str(item.get("code") or "").strip()
            message = str(item.get("message") or "").strip()
            if code or message:
                normalized.append({"code": code, "message": message})
        elif isinstance(item, str) and item.strip():
            normalized.append({"code": "warning", "message": item.strip()})
    return normalized


def _score_summary(bridge_request: IceaBridgeRequest) -> dict[str, Any]:
    return bridge_request.score_summary_json if isinstance(bridge_request.score_summary_json, dict) else {}


def _extract_score_value(score_summary: dict[str, Any]) -> float | None:
    for key in ("score", "riskScore", "value"):
        value = score_summary.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _extract_score_label(score_summary: dict[str, Any]) -> str | None:
    for key in ("riskLabel", "riskLevel", "label", "band"):
        value = score_summary.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_confidence(score_summary: dict[str, Any]) -> dict[str, Any] | None:
    payload = score_summary.get("confidence") if isinstance(score_summary.get("confidence"), dict) else {}
    value = payload.get("value")
    label = payload.get("label")
    normalized_value = float(value) if isinstance(value, (int, float)) else None
    normalized_label = str(label).strip() if isinstance(label, str) and label.strip() else None
    if normalized_value is None and normalized_label is None:
        return None
    return {"value": normalized_value, "label": normalized_label}


def _is_stale(bridge_request: IceaBridgeRequest) -> bool:
    settings = load_icea_bridge_settings()
    if bridge_request.status == IceaBridgeRequest.STATUS_STALE:
        return True
    age = timezone.now() - bridge_request.updated_at
    return age.total_seconds() >= settings.stale_after_seconds


def _clinical_status(bridge_request: IceaBridgeRequest) -> str:
    if bridge_request.status == IceaBridgeRequest.STATUS_FAILED:
        return "failed"
    if bridge_request.status in {
        IceaBridgeRequest.STATUS_QUEUED,
        IceaBridgeRequest.STATUS_SENT,
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
    }:
        return "pending"
    if bridge_request.status == IceaBridgeRequest.STATUS_STALE and not (
        isinstance(bridge_request.score_summary_json, dict) and bridge_request.score_summary_json
    ):
        return "failed"
    if bridge_request.insufficient_evidence:
        return "insufficient_evidence"
    if bridge_request.provisional:
        return "provisional"
    return "complete"


def _build_prudent_message(*, clinical_status: str, stale: bool) -> str:
    messages = {
        "pending": "Apoyo analitico ICEA+ en proceso. No sustituye juicio clinico.",
        "provisional": "Apoyo analitico ICEA+ provisional. No sustituye juicio clinico.",
        "complete": "Apoyo analitico ICEA+ disponible para priorizacion prudente. No sustituye juicio clinico.",
        "insufficient_evidence": "Apoyo analitico ICEA+ con evidencia insuficiente. No sustituye juicio clinico.",
        "failed": "No se pudo recuperar apoyo analitico ICEA+. Mantener valoracion clinica habitual.",
    }
    message = messages.get(clinical_status, "Apoyo analitico ICEA+ no disponible.")
    if stale and clinical_status != "pending":
        return f"{message} Dato potencialmente desactualizado."
    return message


def _extract_causal_summary(snapshot: IceaPipelineSnapshot | None) -> dict[str, Any] | None:
    if not icea_causal_summary_enabled() or snapshot is None or not isinstance(snapshot.causal_report_json, dict):
        return None
    report = snapshot.causal_report_json
    report_payload = report.get("report") if isinstance(report.get("report"), dict) else report
    raw_summary = report_payload.get("summary")
    summary_text = None
    if isinstance(raw_summary, str) and raw_summary.strip():
        summary_text = raw_summary.strip()
    elif isinstance(raw_summary, dict):
        for key in ("summary", "text", "shortText", "message", "title"):
            value = raw_summary.get(key)
            if isinstance(value, str) and value.strip():
                summary_text = value.strip()
                break
    updated_at = None
    for key in ("updatedAt", "generatedAt"):
        value = report_payload.get(key)
        if isinstance(value, str) and value.strip():
            updated_at = value.strip()
            break
    available = bool(report_payload.get("available")) or summary_text is not None
    if not available:
        return None
    return {
        "available": True,
        "summary": summary_text,
        "updatedAt": updated_at,
    }


def _suppressed_display_message() -> str:
    return "La gobernanza del piloto mantiene el score individual y cualquier resumen causal fuera de la UI operativa."


def _find_latest_snapshots(bridge_requests: list[IceaBridgeRequest]) -> dict[str, IceaPipelineSnapshot]:
    request_ids = [item.request_id for item in bridge_requests if item.request_id]
    bundle_ids = [item.bundle_id for item in bridge_requests if item.bundle_id]
    snapshots = (
        IceaPipelineSnapshot.objects.filter(request_id__in=request_ids)
        | IceaPipelineSnapshot.objects.filter(bundle_id__in=bundle_ids)
    ).order_by("-updated_at", "-id")
    by_request_id: dict[str, IceaPipelineSnapshot] = {}
    by_bundle_id: dict[str, IceaPipelineSnapshot] = {}
    for snapshot in snapshots:
        if snapshot.request_id and snapshot.request_id not in by_request_id:
            by_request_id[snapshot.request_id] = snapshot
        if snapshot.bundle_id and snapshot.bundle_id not in by_bundle_id:
            by_bundle_id[snapshot.bundle_id] = snapshot
    resolved: dict[str, IceaPipelineSnapshot] = {}
    for bridge_request in bridge_requests:
        snapshot = by_request_id.get(bridge_request.request_id) or by_bundle_id.get(bridge_request.bundle_id)
        if snapshot is not None:
            resolved[str(bridge_request.id)] = snapshot
    return resolved


def serialize_patient_risk_summary(
    *,
    bridge_request: IceaBridgeRequest,
    snapshot: IceaPipelineSnapshot | None = None,
) -> dict[str, Any]:
    bridge_request = expire_icea_bridge_request_if_due(bridge_request)
    clinical_status = _clinical_status(bridge_request)
    stale = _is_stale(bridge_request)
    warnings = _normalize_warnings(bridge_request.warnings_json)
    message = _build_prudent_message(clinical_status=clinical_status, stale=stale)
    return {
        "patientId": bridge_request.patient_id,
        "unitId": bridge_request.unit_id,
        "handoverId": bridge_request.bundle_id,
        "requestId": bridge_request.request_id,
        "clinicalStatus": clinical_status,
        "stale": stale,
        "score": None,
        "scoreLabel": None,
        "confidence": None,
        "warnings": warnings,
        "message": f"{message} {_suppressed_display_message()}",
        "calculatedAt": bridge_request.received_at.isoformat() if bridge_request.received_at else None,
        "lastUpdatedAt": bridge_request.updated_at.isoformat(),
        "provenance": {
            "source": "HANDOVER",
            "provider": "ICEA+",
            "scoringMode": bridge_request.scoring_mode,
            "contractVersion": bridge_request.contract_version or None,
            "formulaVersion": bridge_request.formula_version or None,
            "bridgeStatus": bridge_request.status,
            "localStatusIsAuthoritative": True,
            "displayPolicy": "shadow_aggregated_no_individual_score",
            "individualScoreVisible": False,
            "causalSummaryVisible": False,
        },
        "causalSummary": None,
    }


def list_patient_risk_summaries(
    *,
    patient_id: str | None = None,
    unit_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    queryset = IceaBridgeRequest.objects.all().order_by("-updated_at", "-id")
    if patient_id:
        queryset = queryset.filter(patient_id=patient_id)
    elif not patient_id:
        queryset = queryset.exclude(patient_id__in=["", "unknown"])
    if unit_id:
        queryset = queryset.filter(unit_id=unit_id)
    materialize_icea_bridge_requests_if_due(queryset)

    selected: list[IceaBridgeRequest] = []
    seen_patient_ids: set[str] = set()
    for item in queryset:
        patient_key = str(item.patient_id or "").strip()
        if not patient_key:
            continue
        if patient_id:
            selected.append(item)
            break
        if patient_key in seen_patient_ids:
            continue
        seen_patient_ids.add(patient_key)
        selected.append(item)
        if len(selected) >= limit:
            break

    snapshots_by_bridge_id = _find_latest_snapshots(selected)
    return [
        serialize_patient_risk_summary(
            bridge_request=item,
            snapshot=snapshots_by_bridge_id.get(str(item.id)),
        )
        for item in selected
    ]
