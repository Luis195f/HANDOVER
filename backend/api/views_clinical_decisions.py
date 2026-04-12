from __future__ import annotations

from typing import Any

from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.clinical_decision_summary import (
    CLINICAL_DECISION_ALLOWED_DECISIONS,
    CLINICAL_DECISION_ALLOWED_SECTIONS,
    CLINICAL_DECISION_ALLOWED_SOURCES,
    build_clinical_decision_summary_payload,
)
from backend.api.pilot_control import resolve_roles_from_request
from backend.api.views import (
    AuthenticatedAPIView,
    _extract_authorized_unit_ids,
    _get_claims_from_request,
    _unit_scope_error_response,
)
from backend.audit.service import emit_audit_event
from backend.security.permissions_roles import HasAnyRole
from backend.security.roles import extract_roles


QUERY_ROLES = HasAnyRole.required("supervisor", "admin")


class ClinicalDecisionSummaryQuerySerializer(serializers.Serializer):
    unitId = serializers.CharField(max_length=255, required=False, allow_blank=True)
    suggestionSource = serializers.ChoiceField(
        choices=sorted(CLINICAL_DECISION_ALLOWED_SOURCES),
        required=False,
        allow_blank=True,
    )
    decision = serializers.ChoiceField(
        choices=sorted(CLINICAL_DECISION_ALLOWED_DECISIONS),
        required=False,
        allow_blank=True,
    )
    section = serializers.ChoiceField(
        choices=sorted(CLINICAL_DECISION_ALLOWED_SECTIONS),
        required=False,
        allow_blank=True,
    )
    dateFrom = serializers.CharField(max_length=64, required=False, allow_blank=True)
    dateTo = serializers.CharField(max_length=64, required=False, allow_blank=True)

    def validate_unitId(self, value: str) -> str:
        return value.strip()

    def validate_dateFrom(self, value: str) -> str:
        normalized = value.strip()
        if normalized and parse_datetime(normalized) is None and parse_date(normalized) is None:
            raise serializers.ValidationError("dateFrom must be ISO datetime or YYYY-MM-DD.")
        return normalized

    def validate_dateTo(self, value: str) -> str:
        normalized = value.strip()
        if normalized and parse_datetime(normalized) is None and parse_date(normalized) is None:
            raise serializers.ValidationError("dateTo must be ISO datetime or YYYY-MM-DD.")
        return normalized


class ClinicalDecisionSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    @staticmethod
    def _emit_summary_audit(
        request,
        *,
        status: str,
        http_status: int,
        params: dict[str, Any] | None = None,
        error_code: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        raw_params = params or {}
        safe_query = {
            key: value
            for key in ("unitId", "suggestionSource", "decision", "section", "dateFrom", "dateTo")
            if (value := str(raw_params.get(key) or "").strip())
        }
        meta: dict[str, Any] = {"summaryQuery": safe_query}
        if error_code:
            meta["errorCode"] = error_code
        if isinstance(payload, dict):
            totals = payload.get("totals") if isinstance(payload.get("totals"), dict) else {}
            meta["summaryResult"] = {
                "available": bool(payload.get("available")),
                "enabled": bool(payload.get("enabled", payload.get("available"))),
                "totalEvents": totals.get("events"),
            }

        emit_audit_event(
            event_type="clinical_decision_summary_access",
            action="read",
            status=status,
            http_status=http_status,
            request=request,
            resource_type="ClinicalDecisionEvent",
            resource_id=safe_query.get("unitId", ""),
            meta=meta,
        )

    @staticmethod
    def _resolve_summary_unit_scope(request, *, requested_unit: str | None):
        claims = _get_claims_from_request(request) or {}
        if not isinstance(claims, dict):
            return None, _unit_scope_error_response(
                detail="Patient scope could not be resolved for this token.",
                code="patients_unit_scope_unavailable",
            )

        roles = extract_roles(claims)
        if "admin" in roles:
            return None, None

        authorized_unit_ids = _extract_authorized_unit_ids(claims)
        if not authorized_unit_ids:
            return None, _unit_scope_error_response(
                detail="Patient scope could not be resolved for this token.",
                code="patients_unit_scope_unavailable",
            )

        if requested_unit and requested_unit not in authorized_unit_ids:
            return None, _unit_scope_error_response(
                detail="Requested unit is outside your authorized scope.",
                code="patients_forbidden_unit",
            )

        return authorized_unit_ids, None

    def get(self, request):
        serializer = ClinicalDecisionSummaryQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            self._emit_summary_audit(
                request,
                status="fail",
                http_status=400,
                params=request.query_params,
                error_code="invalid_clinical_decision_summary_query",
            )
            return Response(
                {
                    "detail": "Invalid clinical decision summary query.",
                    "code": "invalid_clinical_decision_summary_query",
                    "errors": serializer.errors,
                },
                status=400,
            )

        params = serializer.validated_data
        authorized_unit_ids, scope_error = self._resolve_summary_unit_scope(
            request,
            requested_unit=params.get("unitId"),
        )
        if scope_error is not None:
            error_code = ""
            if isinstance(getattr(scope_error, "data", None), dict):
                error_code = str(scope_error.data.get("code") or "").strip()
            self._emit_summary_audit(
                request,
                status="fail",
                http_status=scope_error.status_code,
                params=params,
                error_code=error_code or "clinical_decision_summary_scope_error",
            )
            return scope_error

        payload = build_clinical_decision_summary_payload(
            unit_id=params.get("unitId"),
            authorized_unit_ids=authorized_unit_ids,
            suggestion_source=params.get("suggestionSource"),
            decision=params.get("decision"),
            section=params.get("section"),
            date_from=params.get("dateFrom"),
            date_to=params.get("dateTo"),
            roles=resolve_roles_from_request(request),
        )
        self._emit_summary_audit(
            request,
            status="success",
            http_status=200,
            params=params,
            payload=payload,
        )
        return Response(payload, status=200)
