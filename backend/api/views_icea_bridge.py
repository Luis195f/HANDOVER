from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.api.icea_bridge_service import (
    enqueue_icea_bridge_request_for_bundle_record,
    load_icea_bridge_settings,
    refresh_icea_bridge_request,
    schedule_icea_bridge_delivery,
    score_configuration_error_code,
    score_configuration_error_detail,
    serialize_bridge_request,
    serialize_bridge_summary,
)
from backend.api.icea_clinical_feedback import icea_patient_risk_enabled, list_patient_risk_summaries
from backend.api.icea_pipeline import (
    IceaPipelineConfigurationError,
    IceaPipelineHTTPStatusError,
    IceaPipelineTransportError,
)
from backend.api.models import HandoverBundleRecord, IceaBridgeRequest
from backend.api.views import AuthenticatedAPIView
from backend.security.permissions_roles import HasAnyRole
from backend.security.roles import extract_roles

CLINICAL_ROLES = HasAnyRole.required('nurse', 'supervisor', 'admin')
QUERY_ROLES = HasAnyRole.required('supervisor', 'admin')
ACTION_ROLES = HasAnyRole.required('admin')
REFRESHABLE_STATUSES = {
    IceaBridgeRequest.STATUS_ACCEPTED,
    IceaBridgeRequest.STATUS_PENDING,
    IceaBridgeRequest.STATUS_STALE,
}


def _truthy(value: str | None) -> bool:
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _latest_bridge_request(*, handover_id: str, scoring_mode: str | None = None) -> IceaBridgeRequest | None:
    queryset = IceaBridgeRequest.objects.filter(bundle_id=handover_id)
    if scoring_mode:
        queryset = queryset.filter(scoring_mode=scoring_mode)
    return queryset.order_by('-updated_at').first()


def _can_query_all_patient_risk(request) -> bool:
    claims = getattr(request, 'auth', None)
    if not isinstance(claims, dict):
        claims = getattr(getattr(request, 'user', None), 'claims', None)
    roles = extract_roles(claims) if isinstance(claims, dict) else set()
    return bool(roles & {'supervisor', 'admin'})


def _patient_risk_claims(request) -> dict[str, Any]:
    claims = getattr(request, 'auth', None)
    if isinstance(claims, dict):
        return claims
    user_claims = getattr(getattr(request, 'user', None), 'claims', None)
    if isinstance(user_claims, dict):
        return user_claims
    return {}


def _to_string_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.replace(',', ' ').split() if item.strip()]
    return []


def _extract_authorized_unit_ids(claims: dict[str, Any]) -> set[str]:
    collected: set[str] = set()
    for key in ('unitIds', 'units', 'https://handover/unitIds', 'https://handoverpro/unitIds'):
        for value in _to_string_list(claims.get(key)):
            collected.add(value)
    return collected


def _resolve_patient_risk_scope(request, *, patient_id: str | None, unit_id: str | None) -> tuple[str | None, Response | None]:
    claims = _patient_risk_claims(request)
    roles = extract_roles(claims)
    if roles & {'supervisor', 'admin'}:
        return unit_id, None

    authorized_unit_ids = _extract_authorized_unit_ids(claims)

    if unit_id:
        if unit_id not in authorized_unit_ids:
            return None, Response(
                {
                    'detail': 'Requested unit is outside your authorized scope.',
                    'code': 'icea_patient_risk_forbidden_unit',
                },
                status=403,
            )
        return unit_id, None

    if patient_id:
        if len(authorized_unit_ids) == 1:
            return next(iter(authorized_unit_ids)), None
        return None, Response(
            {
                'detail': 'unitId is required to resolve patient risk for this user scope.',
                'code': 'icea_patient_risk_unit_required',
            },
            status=400,
        )

    return None, Response(
        {
            'detail': 'unitId is required for this role.',
            'code': 'icea_patient_risk_filter_required',
        },
        status=400,
    )


class IceaBridgeStatusDetailView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, CLINICAL_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request, handover_id: str):
        scoring_mode = str(request.query_params.get('scoringMode') or '').strip() or None
        bridge_request = _latest_bridge_request(handover_id=handover_id, scoring_mode=scoring_mode)
        if bridge_request is None:
            return Response({'detail': 'ICEA bridge request not found.', 'code': 'icea_bridge_not_found'}, status=404)

        settings = load_icea_bridge_settings()
        should_refresh = _truthy(request.query_params.get('refresh'))
        remote_status_supported = bool(settings.enabled and settings.has_remote_status)
        local_status_is_authoritative = not remote_status_supported
        remote_refresh_attempted = False
        remote_error = None
        configuration_error = score_configuration_error_code(
            scoring_mode=bridge_request.scoring_mode,
            settings_obj=settings,
        )

        if should_refresh and remote_status_supported and bridge_request.status in REFRESHABLE_STATUSES:
            remote_refresh_attempted = True
            try:
                refresh_icea_bridge_request(bridge_request)
                bridge_request.refresh_from_db()
            except IceaPipelineConfigurationError as exc:
                remote_error = {'code': exc.detail}
            except IceaPipelineTransportError as exc:
                remote_error = {'code': 'icea_transport_error', 'detail': exc.detail}
            except IceaPipelineHTTPStatusError as exc:
                remote_error = {'code': 'icea_remote_error', 'detail': exc.detail, 'remoteStatus': exc.http_status}
        elif should_refresh and not remote_status_supported:
            remote_error = {'code': 'icea_bridge_status_not_configured'}

        payload: dict[str, Any] = {
            'bridgeRequest': serialize_bridge_request(bridge_request),
            'summary': serialize_bridge_summary(bridge_request),
            'remoteStatusSupported': remote_status_supported,
            'remoteRefreshAttempted': remote_refresh_attempted,
            'localStatusIsAuthoritative': local_status_is_authoritative,
        }
        if configuration_error not in (None, 'icea_bridge_disabled'):
            payload['configurationError'] = {
                'code': configuration_error,
                'detail': score_configuration_error_detail(configuration_error),
            }
        if remote_error is not None:
            payload['remoteError'] = remote_error
        return Response(payload, status=200)


class IceaBridgeStatusQueryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, QUERY_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        queryset = IceaBridgeRequest.objects.all()
        for query_key, model_key in (
            ('requestId', 'request_id'),
            ('patientId', 'patient_id'),
            ('unitId', 'unit_id'),
            ('shift', 'shift'),
            ('status', 'status'),
            ('scoringMode', 'scoring_mode'),
        ):
            value = str(request.query_params.get(query_key) or '').strip()
            if value:
                queryset = queryset.filter(**{model_key: value})
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 100))
        results = [serialize_bridge_request(item) for item in queryset.order_by('-updated_at')[:limit]]
        return Response({'results': results, 'count': len(results)}, status=200)


class IceaBridgeSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, CLINICAL_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request, handover_id: str):
        scoring_mode = str(request.query_params.get('scoringMode') or '').strip() or None
        bridge_request = _latest_bridge_request(handover_id=handover_id, scoring_mode=scoring_mode)
        if bridge_request is None:
            return Response({'detail': 'ICEA bridge request not found.', 'code': 'icea_bridge_not_found'}, status=404)
        return Response({'summary': serialize_bridge_summary(bridge_request)}, status=200)


class IceaPatientRiskSummaryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, CLINICAL_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def get(self, request):
        if not icea_patient_risk_enabled():
            return Response(
                {'detail': 'ICEA patient risk support is disabled.', 'code': 'icea_patient_risk_disabled'},
                status=503,
            )

        patient_id = str(request.query_params.get('patientId') or '').strip() or None
        unit_id = str(request.query_params.get('unitId') or '').strip() or None
        try:
            limit = int(request.query_params.get('limit') or 20)
        except (TypeError, ValueError):
            limit = 20
        limit = max(1, min(limit, 100))

        effective_unit_id, scope_error = _resolve_patient_risk_scope(
            request,
            patient_id=patient_id,
            unit_id=unit_id,
        )
        if scope_error is not None:
            return scope_error

        results = list_patient_risk_summaries(patient_id=patient_id, unit_id=effective_unit_id, limit=limit)
        return Response({'enabled': True, 'results': results, 'count': len(results)}, status=200)


class IceaBridgeRetryView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, ACTION_ROLES]

    def get_permissions(self):
        return [permission() for permission in self.permission_classes]

    def post(self, request, bridge_id: int):
        bridge_request = IceaBridgeRequest.objects.filter(id=bridge_id).first()
        if bridge_request is None:
            return Response({'detail': 'ICEA bridge request not found.', 'code': 'icea_bridge_not_found'}, status=404)

        payload = request.data if isinstance(request.data, dict) else {}
        requested_mode = str(payload.get('scoringMode') or '').strip() or bridge_request.scoring_mode
        if requested_mode not in {
            IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            IceaBridgeRequest.SCORING_MODE_ENRICHED,
        }:
            return Response({'detail': 'Unsupported scoring mode.', 'code': 'invalid_scoring_mode'}, status=400)

        settings = load_icea_bridge_settings()
        if not settings.enabled or not settings.allows_mode(requested_mode):
            return Response({'detail': 'ICEA bridge is disabled for this scoring mode.', 'code': 'icea_bridge_disabled'}, status=503)

        configuration_error = score_configuration_error_code(scoring_mode=requested_mode, settings_obj=settings)
        if configuration_error not in (None, 'icea_bridge_disabled'):
            return Response({'detail': score_configuration_error_detail(configuration_error), 'code': configuration_error}, status=503)

        if requested_mode == bridge_request.scoring_mode:
            schedule_icea_bridge_delivery(bridge_request.id, force=True)
            bridge_request.refresh_from_db()
            return Response({'bridgeRequest': serialize_bridge_request(bridge_request)}, status=202)

        record = HandoverBundleRecord.objects.filter(request_id=bridge_request.request_id).first()
        if record is None:
            record = HandoverBundleRecord.objects.filter(bundle_id=bridge_request.bundle_id).first()
        if record is None:
            return Response({'detail': 'Local handover bundle not found.', 'code': 'handover_bundle_not_found'}, status=404)

        retriggered = enqueue_icea_bridge_request_for_bundle_record(record=record, scoring_mode=requested_mode)
        if retriggered is None:
            return Response({'detail': 'ICEA bridge is disabled for this scoring mode.', 'code': 'icea_bridge_disabled'}, status=503)
        return Response({'bridgeRequest': serialize_bridge_request(retriggered)}, status=202)

