from __future__ import annotations

from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.pilot_control import (
    resolve_roles_from_request,
    serialize_pilot_control_features,
    serialize_pilot_control_summary,
)
from backend.api.views import AuthenticatedAPIView, _resolve_unit_scope
from backend.security.permissions_roles import HasAnyRole

PILOT_CONTROL_QUERY_ROLES = HasAnyRole.required("supervisor", "admin")


def _query_roles(request) -> list[str]:
    if getattr(settings, 'HANDOVER_DEPLOYMENT_MODE', '') in {'pilot', 'production'}:
        return resolve_roles_from_request(request)
    explicit_roles = request.query_params.getlist("role") or request.query_params.getlist("roles")
    if explicit_roles:
        return [role.strip().lower() for role in explicit_roles if isinstance(role, str) and role.strip()]
    return resolve_roles_from_request(request)


def _pilot_unit_scope(request):
    unit_id = str(request.query_params.get('unitId') or '').strip() or None
    authorized_unit_ids, scope_error = _resolve_unit_scope(
        request,
        requested_unit=unit_id,
        scope_unavailable_detail='Pilot control unit scope could not be resolved for this token.',
        scope_unavailable_code='pilot_control_unit_scope_unavailable',
        forbidden_detail='Requested unit is outside your authorized scope.',
        forbidden_code='pilot_control_forbidden_unit',
    )
    if scope_error is not None:
        return None, scope_error
    if unit_id is None and authorized_unit_ids is not None:
        if len(authorized_unit_ids) != 1:
            return None, Response({'detail': 'unitId is required for this token scope.', 'code': 'pilot_control_unit_required'}, status=400)
        unit_id = next(iter(authorized_unit_ids))
    return unit_id, None


class PilotControlSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, PILOT_CONTROL_QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id, scope_error = _pilot_unit_scope(request)
        if scope_error is not None:
            return scope_error
        payload = serialize_pilot_control_summary(
            unit_id=unit_id,
            roles=_query_roles(request),
        )
        return Response(payload, status=200)


class PilotControlFeaturesView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id, scope_error = _pilot_unit_scope(request)
        if scope_error is not None:
            return scope_error
        payload = serialize_pilot_control_features(
            unit_id=unit_id,
            roles=resolve_roles_from_request(request),
        )
        return Response(payload, status=200)
