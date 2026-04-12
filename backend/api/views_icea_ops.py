from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.icea_ops import (
    build_icea_ops_events_payload,
    build_icea_ops_summary_payload,
    build_icea_ops_unit_payload,
)
from backend.api.views import AuthenticatedAPIView, _resolve_unit_scope
from backend.security.permissions_roles import HasAnyRole


QUERY_ROLES = HasAnyRole.required("supervisor", "admin")


def _resolve_ops_unit_scope(request, *, requested_unit: str | None, require_requested_unit: bool = False):
    return _resolve_unit_scope(
        request,
        requested_unit=requested_unit,
        scope_unavailable_detail="ICEA operations scope could not be resolved for this token.",
        scope_unavailable_code="icea_ops_unit_scope_unavailable",
        forbidden_detail="Requested unit is outside your authorized scope.",
        forbidden_code="icea_ops_forbidden_unit",
        required_unit_detail="unitId is required for this token scope." if require_requested_unit else None,
        required_unit_code="icea_ops_unit_filter_required" if require_requested_unit else None,
    )


class IceaOpsSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        authorized_unit_ids, scope_error = _resolve_ops_unit_scope(request, requested_unit=None)
        if scope_error is not None:
            return scope_error
        return Response(build_icea_ops_summary_payload(authorized_unit_ids=authorized_unit_ids), status=200)


class IceaOpsEventsView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id = str(request.query_params.get("unitId") or "").strip() or None
        authorized_unit_ids, scope_error = _resolve_ops_unit_scope(request, requested_unit=unit_id)
        if scope_error is not None:
            return scope_error
        try:
            limit = int(request.query_params.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        return Response(
            build_icea_ops_events_payload(
                unit_id=unit_id,
                authorized_unit_ids=authorized_unit_ids,
                limit=limit,
            ),
            status=200,
        )


class IceaOpsUnitView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request, unit_id: str):
        _, scope_error = _resolve_ops_unit_scope(request, requested_unit=unit_id, require_requested_unit=True)
        if scope_error is not None:
            return scope_error
        return Response(build_icea_ops_unit_payload(unit_id=unit_id), status=200)
