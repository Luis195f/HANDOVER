from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.pilot_control import resolve_roles_from_request, serialize_pilot_control_summary
from backend.api.views import AuthenticatedAPIView
from backend.security.permissions_roles import HasAnyRole

PILOT_CONTROL_QUERY_ROLES = HasAnyRole.required("supervisor", "admin")


def _query_roles(request) -> list[str]:
    explicit_roles = request.query_params.getlist("role") or request.query_params.getlist("roles")
    if explicit_roles:
        return [role.strip().lower() for role in explicit_roles if isinstance(role, str) and role.strip()]
    return resolve_roles_from_request(request)


class PilotControlSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, PILOT_CONTROL_QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id = str(request.query_params.get("unitId") or "").strip() or None
        payload = serialize_pilot_control_summary(
            unit_id=unit_id,
            roles=_query_roles(request),
        )
        return Response(payload, status=200)
