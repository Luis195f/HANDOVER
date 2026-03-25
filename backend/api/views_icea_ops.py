from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.icea_ops import (
    build_icea_ops_events_payload,
    build_icea_ops_summary_payload,
    build_icea_ops_unit_payload,
)
from backend.api.views import AuthenticatedAPIView
from backend.security.permissions_roles import HasAnyRole


QUERY_ROLES = HasAnyRole.required("supervisor", "admin")


class IceaOpsSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, _request):
        return Response(build_icea_ops_summary_payload(), status=200)


class IceaOpsEventsView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        unit_id = str(request.query_params.get("unitId") or "").strip() or None
        try:
            limit = int(request.query_params.get("limit") or 20)
        except (TypeError, ValueError):
            limit = 20
        return Response(build_icea_ops_events_payload(unit_id=unit_id, limit=limit), status=200)


class IceaOpsUnitView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, _request, unit_id: str):
        return Response(build_icea_ops_unit_payload(unit_id=unit_id), status=200)
