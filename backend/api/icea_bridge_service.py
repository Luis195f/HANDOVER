from __future__ import annotations

import datetime
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from django.db import close_old_connections
from django.db.models import F
from django.db.models.query import QuerySet
from django.http import HttpRequest
from django.utils import timezone

from backend.api.clinical_storage import ClinicalBundleStorageError, decrypt_bundle_document
from backend.api.icea_payload_mapper import CONTRACT_VERSION, SOURCE, build_icea_bridge_payload, compute_payload_hash
from backend.api.icea_pipeline import (
    IceaPipelineConfigurationError,
    IceaPipelineHTTPStatusError,
    IceaPipelineService,
    IceaPipelineTransportError,
)
from backend.api.models import HandoverBundleRecord, IceaBridgeRequest
from backend.api.pilot_control import is_pilot_feature_enabled

DEFAULT_RETRYABLE_HTTP_STATUS_CODES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})
STORED_BUNDLE_UNAVAILABLE_ERROR = 'stored_bundle_unavailable'
REMOTE_STATUS_TIMEOUT_ERROR = 'remote_status_timeout'
FEATURE_CONTRACT_VERSION = 'handover-icea-feature-v1'
FEATURE_SOURCE_REPO = 'Luis195f/HANDOVER'
NON_SCORING_REMOTE_STATUSES = frozenset({'contract_mismatch', 'insufficient_evidence', 'low_feature_coverage'})


@dataclass(frozen=True)
class IceaBridgeSettings:
    enabled: bool
    immediate_enabled: bool
    enriched_enabled: bool
    model_id: str
    timeout_ms: int
    retry_max: int
    retry_base_seconds: int
    retry_max_delay_seconds: int
    retryable_status_codes: frozenset[int]
    score_path: str
    status_path: str
    stale_after_seconds: int

    @property
    def has_remote_status(self) -> bool:
        return bool(self.status_path)

    def allows_mode(self, scoring_mode: str) -> bool:
        if scoring_mode == IceaBridgeRequest.SCORING_MODE_IMMEDIATE:
            return self.immediate_enabled
        if scoring_mode == IceaBridgeRequest.SCORING_MODE_ENRICHED:
            return self.enriched_enabled
        return False


@dataclass(frozen=True)
class IceaBridgeDeliveryResult:
    delivered: bool
    status: str
    http_status: int | None = None
    detail: str = ''


@dataclass(frozen=True)
class IceaBridgeRemoteResponse:
    status_code: int
    body_json: dict[str, Any] | list[Any] | None


@dataclass(frozen=True)
class IceaBridgeUpsertResult:
    bridge_request: IceaBridgeRequest
    created: bool
    payload_changed: bool
    already_queued: bool

    @property
    def should_schedule(self) -> bool:
        return self.created or (self.payload_changed and not self.already_queued)


@dataclass(frozen=True)
class IceaBridgePersistenceResult:
    bridge_request: IceaBridgeRequest | None
    updated: bool


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _running_tests() -> bool:
    return bool(os.getenv('PYTEST_CURRENT_TEST'))


def _parse_retryable_status_codes(value: str | None) -> frozenset[int]:
    if value is None:
        return DEFAULT_RETRYABLE_HTTP_STATUS_CODES
    parsed: set[int] = set()
    for raw_part in value.replace(';', ',').split(','):
        part = raw_part.strip()
        if not part:
            continue
        try:
            parsed.add(int(part))
        except ValueError:
            continue
    return frozenset(parsed or DEFAULT_RETRYABLE_HTTP_STATUS_CODES)


def load_icea_bridge_settings() -> IceaBridgeSettings:
    enabled = _env_bool('ENABLE_ICEA_BRIDGE', False)
    timeout_ms = max(_env_int('ICEA_BRIDGE_TIMEOUT_MS', _env_int('ICEA_API_TIMEOUT_MS', 5000)), 100)
    retry_base_seconds = max(_env_int('ICEA_BRIDGE_RETRY_BASE_SECONDS', 30), 1)
    retry_max_delay_seconds = max(_env_int('ICEA_BRIDGE_RETRY_MAX_DELAY_SECONDS', 300), retry_base_seconds)
    return IceaBridgeSettings(
        enabled=enabled,
        immediate_enabled=_env_bool('ENABLE_ICEA_IMMEDIATE_SCORING', False),
        enriched_enabled=_env_bool('ENABLE_ICEA_ENRICHED_SCORING', False),
        model_id=(os.getenv('ICEA_BRIDGE_MODEL_ID') or '').strip(),
        timeout_ms=timeout_ms,
        retry_max=max(_env_int('ICEA_BRIDGE_RETRY_MAX', 3), 1),
        retry_base_seconds=retry_base_seconds,
        retry_max_delay_seconds=retry_max_delay_seconds,
        retryable_status_codes=_parse_retryable_status_codes(os.getenv('ICEA_BRIDGE_RETRYABLE_STATUS_CODES')),
        score_path=(os.getenv('ICEA_BRIDGE_SCORE_PATH') or '/api/v1/icea-plus/score/').strip(),
        status_path=(os.getenv('ICEA_BRIDGE_STATUS_PATH') or '').strip(),
        stale_after_seconds=max(_env_int('ICEA_BRIDGE_STALE_AFTER_SECONDS', 1800), 60),
    )


def _score_configuration_error(settings: IceaBridgeSettings, *, scoring_mode: str | None = None) -> str | None:
    if not settings.enabled:
        return 'icea_bridge_disabled'
    if scoring_mode and not settings.allows_mode(scoring_mode):
        return 'icea_bridge_disabled'
    model_id = settings.model_id.strip()
    if not model_id:
        return 'missing_icea_bridge_model_id'
    try:
        uuid.UUID(model_id)
    except ValueError:
        return 'invalid_icea_bridge_model_id'
    return None


def _scoring_feature_key(scoring_mode: str) -> str:
    if scoring_mode == IceaBridgeRequest.SCORING_MODE_ENRICHED:
        return 'icea_enriched_scoring'
    return 'icea_immediate_scoring'


def score_configuration_error_code(
    scoring_mode: str | None = None,
    *,
    settings_obj: IceaBridgeSettings | None = None,
) -> str | None:
    return _score_configuration_error(settings_obj or load_icea_bridge_settings(), scoring_mode=scoring_mode)


def score_configuration_error_detail(code: str) -> str:
    return {
        'icea_bridge_disabled': 'ICEA bridge is disabled for this scoring mode.',
        'missing_icea_bridge_model_id': 'ICEA bridge score delivery requires ICEA_BRIDGE_MODEL_ID.',
        'invalid_icea_bridge_model_id': 'ICEA_BRIDGE_MODEL_ID must be a valid UUID.',
    }.get(code, 'ICEA bridge score delivery is not configured.')


def _extract_request_id(request: HttpRequest) -> str:
    for candidate in (
        request.headers.get('Idempotency-Key'),
        request.META.get('HTTP_IDEMPOTENCY_KEY'),
        request.headers.get('X-Request-ID'),
        request.META.get('HTTP_X_REQUEST_ID'),
        getattr(request, 'audit_request_id', ''),
    ):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ''


def _bridge_request_id(request_id: str, scoring_mode: str) -> str:
    return f'{request_id}:{scoring_mode}'


def _idempotency_key(request_id: str, scoring_mode: str, payload_hash: str) -> str:
    return f'{request_id}:{scoring_mode}:{payload_hash[:16]}'


def _is_terminal_status(status: str) -> bool:
    return status in {
        IceaBridgeRequest.STATUS_SCORED,
        IceaBridgeRequest.STATUS_FAILED,
        IceaBridgeRequest.STATUS_STALE,
    }


def _retry_delay_seconds(*, settings: IceaBridgeSettings, attempt: int) -> int:
    return min(
        settings.retry_base_seconds * (2 ** max(attempt - 1, 0)),
        settings.retry_max_delay_seconds,
    )


def _compute_next_retry_at(*, settings: IceaBridgeSettings, attempt: int, now: datetime.datetime) -> datetime.datetime:
    return now + datetime.timedelta(seconds=_retry_delay_seconds(settings=settings, attempt=attempt))


def _active_bridge_statuses() -> tuple[str, str, str]:
    return (
        IceaBridgeRequest.STATUS_SENT,
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
    )


def _bridge_stale_deadline(*, bridge_request: IceaBridgeRequest, settings: IceaBridgeSettings) -> datetime.datetime:
    return bridge_request.updated_at + datetime.timedelta(seconds=settings.stale_after_seconds)



def _bundle_unavailable_payload(record: HandoverBundleRecord) -> dict[str, Any]:
    return {
        'contractVersion': CONTRACT_VERSION,
        'identity': {
            'bundleId': record.bundle_id,
            'patientId': record.patient_id,
            'requestId': record.request_id,
        },
        'context': {'unitId': record.unit_id},
    }


def _mark_bundle_unavailable(record: HandoverBundleRecord, *, scoring_mode: str) -> IceaBridgeRequest:
    upsert_result = _upsert_bridge_request(
        request_id=record.request_id,
        scoring_mode=scoring_mode,
        payload=_bundle_unavailable_payload(record),
    )
    bridge_request = upsert_result.bridge_request
    _mark_failed(bridge_request, detail=STORED_BUNDLE_UNAVAILABLE_ERROR)
    bridge_request.refresh_from_db()
    return bridge_request

def enqueue_icea_bridge_request_for_transaction(
    *,
    bundle: dict[str, Any],
    request: HttpRequest,
    scoring_mode: str = IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
) -> IceaBridgeRequest | None:
    settings = load_icea_bridge_settings()
    request_unit_id = str(request.headers.get('X-Unit-Id') or '').strip() or None
    if not settings.enabled or not settings.allows_mode(scoring_mode):
        return None
    request_id = _extract_request_id(request)
    if not request_id:
        return None
    payload = build_icea_bridge_payload(
        bundle,
        request_id=request_id,
        scoring_mode=scoring_mode,
        unit_id=request_unit_id or '',
    )
    payload_context = payload.get('context') if isinstance(payload.get('context'), dict) else {}
    effective_unit_id = str(payload_context.get('unitId') or request_unit_id or '').strip() or None
    if (
        not is_pilot_feature_enabled('icea_bridge', unit_id=effective_unit_id)
        or not is_pilot_feature_enabled(_scoring_feature_key(scoring_mode), unit_id=effective_unit_id)
    ):
        return None
    upsert_result = _upsert_bridge_request(
        request_id=request_id,
        scoring_mode=scoring_mode,
        payload=payload,
    )
    bridge_request = upsert_result.bridge_request
    configuration_error = _score_configuration_error(settings, scoring_mode=scoring_mode)
    if configuration_error is not None:
        _mark_failed(bridge_request, detail=configuration_error)
        bridge_request.refresh_from_db()
        return bridge_request
    if upsert_result.should_schedule:
        schedule_icea_bridge_delivery(bridge_request.id)
    return bridge_request


def enqueue_icea_bridge_request_for_bundle_record(
    *,
    record: HandoverBundleRecord,
    scoring_mode: str,
    force_delivery: bool = False,
) -> IceaBridgeRequest | None:
    settings = load_icea_bridge_settings()
    if (
        not settings.enabled
        or not settings.allows_mode(scoring_mode)
        or not is_pilot_feature_enabled('icea_bridge', unit_id=record.unit_id)
        or not is_pilot_feature_enabled(_scoring_feature_key(scoring_mode), unit_id=record.unit_id)
    ):
        return None
    try:
        bundle = decrypt_bundle_document(record.bundle_json, encryption_metadata=record.encryption_metadata)
    except ClinicalBundleStorageError:
        return _mark_bundle_unavailable(record, scoring_mode=scoring_mode)

    payload = build_icea_bridge_payload(
        bundle,
        request_id=record.request_id,
        scoring_mode=scoring_mode,
        unit_id=record.unit_id,
    )
    upsert_result = _upsert_bridge_request(
        request_id=record.request_id,
        scoring_mode=scoring_mode,
        payload=payload,
    )
    bridge_request = upsert_result.bridge_request
    configuration_error = _score_configuration_error(settings, scoring_mode=scoring_mode)
    if configuration_error is not None:
        _mark_failed(bridge_request, detail=configuration_error)
        bridge_request.refresh_from_db()
        return bridge_request
    if force_delivery:
        schedule_icea_bridge_delivery(bridge_request.id, force=True)
    elif upsert_result.should_schedule:
        schedule_icea_bridge_delivery(bridge_request.id)
    return bridge_request

def _upsert_bridge_request(*, request_id: str, scoring_mode: str, payload: dict[str, Any]) -> IceaBridgeUpsertResult:
    payload_hash = compute_payload_hash(payload)
    identity = payload.get('identity') if isinstance(payload.get('identity'), dict) else {}
    context = payload.get('context') if isinstance(payload.get('context'), dict) else {}
    defaults = {
        'request_id': request_id,
        'bundle_id': str(identity.get('bundleId') or request_id),
        'patient_id': str(identity.get('patientId') or 'unknown'),
        'unit_id': str(context.get('unitId') or 'unknown'),
        'encounter_id': str(identity.get('encounterId') or ''),
        'composition_id': str(identity.get('compositionId') or ''),
        'episode_id': str(identity.get('episodeId') or identity.get('bundleId') or request_id),
        'shift': str(context.get('shift') or ''),
        'scoring_mode': scoring_mode,
        'idempotency_key': _idempotency_key(request_id, scoring_mode, payload_hash),
        'payload_hash': payload_hash,
        'payload_json': payload,
        'status': IceaBridgeRequest.STATUS_QUEUED,
        'provisional': bool(payload.get('provisional')),
        'insufficient_evidence': bool(((payload.get('uncertaintySignals') or {}) if isinstance(payload.get('uncertaintySignals'), dict) else {}).get('insufficientEvidence')),
        'contract_version': str(payload.get('contractVersion') or CONTRACT_VERSION),
        'warnings_json': ((payload.get('uncertaintySignals') or {}) if isinstance(payload.get('uncertaintySignals'), dict) else {}).get('warnings') or [],
        'next_retry_at': None,
    }
    bridge_request_id = _bridge_request_id(request_id, scoring_mode)
    bridge_request, created = IceaBridgeRequest.objects.get_or_create(
        bridge_request_id=bridge_request_id,
        defaults=defaults,
    )
    if created:
        return IceaBridgeUpsertResult(bridge_request=bridge_request, created=True, payload_changed=False, already_queued=False)
    if bridge_request.payload_hash != payload_hash:
        was_queued = bridge_request.status == IceaBridgeRequest.STATUS_QUEUED
        bridge_request.bundle_id = defaults['bundle_id']
        bridge_request.patient_id = defaults['patient_id']
        bridge_request.unit_id = defaults['unit_id']
        bridge_request.encounter_id = defaults['encounter_id']
        bridge_request.composition_id = defaults['composition_id']
        bridge_request.episode_id = defaults['episode_id']
        bridge_request.shift = defaults['shift']
        bridge_request.idempotency_key = defaults['idempotency_key']
        bridge_request.payload_hash = payload_hash
        bridge_request.payload_json = payload
        bridge_request.provisional = defaults['provisional']
        bridge_request.insufficient_evidence = defaults['insufficient_evidence']
        bridge_request.contract_version = defaults['contract_version']
        bridge_request.formula_version = ''
        bridge_request.score_summary_json = None
        bridge_request.warnings_json = defaults['warnings_json']
        bridge_request.remote_refs_json = None
        bridge_request.status = IceaBridgeRequest.STATUS_QUEUED
        bridge_request.attempts = 0
        bridge_request.last_error = ''
        bridge_request.last_http_status = None
        bridge_request.next_retry_at = None
        bridge_request.sent_at = None
        bridge_request.received_at = None
        bridge_request.save(update_fields=[
            'bundle_id',
            'patient_id',
            'unit_id',
            'encounter_id',
            'composition_id',
            'episode_id',
            'shift',
            'idempotency_key',
            'payload_hash',
            'payload_json',
            'provisional',
            'insufficient_evidence',
            'contract_version',
            'formula_version',
            'score_summary_json',
            'warnings_json',
            'remote_refs_json',
            'status',
            'attempts',
            'last_error',
            'last_http_status',
            'next_retry_at',
            'sent_at',
            'received_at',
            'updated_at',
        ])
        return IceaBridgeUpsertResult(bridge_request=bridge_request, created=False, payload_changed=True, already_queued=was_queued)
    return IceaBridgeUpsertResult(bridge_request=bridge_request, created=False, payload_changed=False, already_queued=bridge_request.status == IceaBridgeRequest.STATUS_QUEUED)


def _current_bridge_request(bridge_request_id: int) -> IceaBridgeRequest | None:
    return IceaBridgeRequest.objects.filter(id=bridge_request_id).first()


def _bridge_request_matches_delivery(
    bridge_request: IceaBridgeRequest,
    *,
    expected_payload_hash: str,
    expected_idempotency_key: str,
) -> bool:
    return (
        bridge_request.payload_hash == expected_payload_hash
        and bridge_request.idempotency_key == expected_idempotency_key
    )


def _stale_delivery_result(
    bridge_request: IceaBridgeRequest,
    *,
    http_status: int | None,
) -> IceaBridgeDeliveryResult:
    return IceaBridgeDeliveryResult(
        delivered=bridge_request.status == IceaBridgeRequest.STATUS_SCORED,
        status=bridge_request.status,
        http_status=bridge_request.last_http_status if bridge_request.last_http_status is not None else http_status,
        detail='stale_delivery_ignored',
    )


def _persist_bridge_request_update(
    bridge_request_id: int,
    *,
    update_fields: dict[str, Any],
    updated_at: datetime.datetime,
    expected_payload_hash: str | None = None,
    expected_idempotency_key: str | None = None,
) -> IceaBridgePersistenceResult:
    query = IceaBridgeRequest.objects.filter(id=bridge_request_id)
    if expected_payload_hash is not None and expected_idempotency_key is not None:
        query = query.filter(
            payload_hash=expected_payload_hash,
            idempotency_key=expected_idempotency_key,
        )
    updated = query.update(**update_fields, updated_at=updated_at)
    return IceaBridgePersistenceResult(
        bridge_request=_current_bridge_request(bridge_request_id),
        updated=bool(updated),
    )


def materialize_icea_bridge_requests_if_due(
    queryset: QuerySet[IceaBridgeRequest],
    *,
    now: datetime.datetime | None = None,
) -> QuerySet[IceaBridgeRequest]:
    now = now or timezone.now()
    settings = load_icea_bridge_settings()
    cutoff = now - datetime.timedelta(seconds=settings.stale_after_seconds)
    queryset.filter(
        status__in=_active_bridge_statuses(),
        updated_at__lte=cutoff,
    ).update(
        status=IceaBridgeRequest.STATUS_STALE,
        last_error=REMOTE_STATUS_TIMEOUT_ERROR,
        next_retry_at=None,
        received_at=now,
        updated_at=now,
    )
    return queryset


def _schedule_retry(
    bridge_request: IceaBridgeRequest,
    *,
    settings: IceaBridgeSettings,
    detail: str,
    http_status: int | None = None,
    expected_payload_hash: str | None = None,
    expected_idempotency_key: str | None = None,
) -> IceaBridgeDeliveryResult:
    current_bridge_request = _current_bridge_request(bridge_request.id)
    if current_bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if expected_payload_hash is not None and expected_idempotency_key is not None and not _bridge_request_matches_delivery(
        current_bridge_request,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    ):
        return _stale_delivery_result(current_bridge_request, http_status=http_status)
    bridge_request = current_bridge_request
    received_at = timezone.now()
    next_retry_at = _compute_next_retry_at(settings=settings, attempt=max(bridge_request.attempts, 1), now=received_at)
    persistence = _persist_bridge_request_update(
        bridge_request.id,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
        updated_at=received_at,
        update_fields={
            'status': IceaBridgeRequest.STATUS_QUEUED,
            'last_error': (detail or '')[:255],
            'last_http_status': http_status,
            'next_retry_at': next_retry_at,
            'received_at': received_at,
        },
    )
    if persistence.bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if not persistence.updated:
        return _stale_delivery_result(persistence.bridge_request, http_status=http_status)
    bridge_request = persistence.bridge_request
    delay_seconds = max((next_retry_at - received_at).total_seconds(), 0.0)
    schedule_icea_bridge_delivery(bridge_request.id, delay_seconds=delay_seconds)
    return IceaBridgeDeliveryResult(
        delivered=False,
        status=bridge_request.status,
        http_status=http_status,
        detail=bridge_request.last_error,
    )


def _mark_stale(
    bridge_request: IceaBridgeRequest,
    *,
    detail: str,
    http_status: int | None = None,
    expected_payload_hash: str | None = None,
    expected_idempotency_key: str | None = None,
) -> IceaBridgeDeliveryResult:
    current_bridge_request = _current_bridge_request(bridge_request.id)
    if current_bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if expected_payload_hash is not None and expected_idempotency_key is not None and not _bridge_request_matches_delivery(
        current_bridge_request,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    ):
        return _stale_delivery_result(current_bridge_request, http_status=http_status)
    bridge_request = current_bridge_request
    received_at = timezone.now()
    persistence = _persist_bridge_request_update(
        bridge_request.id,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
        updated_at=received_at,
        update_fields={
            'status': IceaBridgeRequest.STATUS_STALE,
            'last_error': (detail or '')[:255],
            'last_http_status': bridge_request.last_http_status if http_status is None else http_status,
            'next_retry_at': None,
            'received_at': received_at,
        },
    )
    if persistence.bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if not persistence.updated:
        return _stale_delivery_result(persistence.bridge_request, http_status=http_status)
    bridge_request = persistence.bridge_request
    return IceaBridgeDeliveryResult(
        delivered=False,
        status=bridge_request.status,
        http_status=bridge_request.last_http_status if bridge_request.last_http_status is not None else http_status,
        detail=bridge_request.last_error,
    )


def expire_icea_bridge_request(
    bridge_request_id: int,
    *,
    expected_payload_hash: str,
    expected_idempotency_key: str,
    detail: str = REMOTE_STATUS_TIMEOUT_ERROR,
) -> IceaBridgeDeliveryResult:
    bridge_request = _current_bridge_request(bridge_request_id)
    if bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', detail='not_found')
    if bridge_request.status not in {
        IceaBridgeRequest.STATUS_SENT,
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
    }:
        return IceaBridgeDeliveryResult(
            delivered=bridge_request.status == IceaBridgeRequest.STATUS_SCORED,
            status=bridge_request.status,
            http_status=bridge_request.last_http_status,
            detail='resolution_skipped',
        )
    return _mark_stale(
        bridge_request,
        detail=detail,
        http_status=bridge_request.last_http_status,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    )


def expire_icea_bridge_request_if_due(bridge_request: IceaBridgeRequest) -> IceaBridgeRequest:
    bridge_request = _current_bridge_request(bridge_request.id) or bridge_request
    if bridge_request.status not in _active_bridge_statuses():
        return bridge_request
    settings = load_icea_bridge_settings()
    deadline = _bridge_stale_deadline(bridge_request=bridge_request, settings=settings)
    if timezone.now() < deadline:
        return bridge_request
    materialize_icea_bridge_requests_if_due(
        IceaBridgeRequest.objects.filter(
            id=bridge_request.id,
            payload_hash=bridge_request.payload_hash,
            idempotency_key=bridge_request.idempotency_key,
        ),
    )
    return _current_bridge_request(bridge_request.id) or bridge_request


def _build_icea_plus_score_request(bridge_request: IceaBridgeRequest, settings: IceaBridgeSettings) -> dict[str, Any]:
    configuration_error = _score_configuration_error(settings, scoring_mode=bridge_request.scoring_mode)
    if configuration_error is not None:
        raise IceaPipelineConfigurationError(configuration_error)

    model_id = settings.model_id.strip()
    payload = bridge_request.payload_json if isinstance(bridge_request.payload_json, dict) else {}
    row = _build_icea_plus_score_row(payload, bridge_request=bridge_request)
    request_payload = {
        'contract_version': FEATURE_CONTRACT_VERSION,
        'source_repo': FEATURE_SOURCE_REPO,
        'model_id': model_id,
        'grain': row['source_grain'],
        'from_db': False,
        'rows': [row],
        'shadow_mode': True,
        'non_individual_use': True,
    }
    return _validate_icea_plus_score_request_contract(request_payload)


def _build_icea_plus_score_row(payload: dict[str, Any], *, bridge_request: IceaBridgeRequest) -> dict[str, Any]:
    identity = payload.get('identity') if isinstance(payload.get('identity'), dict) else {}
    context = payload.get('context') if isinstance(payload.get('context'), dict) else {}
    contextual_signal = payload.get('contextualSignal') if isinstance(payload.get('contextualSignal'), dict) else {}
    case_mix = payload.get('caseMix') if isinstance(payload.get('caseMix'), dict) else {}
    baseline_scores = case_mix.get('baselineScores') if isinstance(case_mix.get('baselineScores'), dict) else {}
    exposure = payload.get('nursingExposure') if isinstance(payload.get('nursingExposure'), dict) else {}
    change_signals = exposure.get('documentedChangeSignals') if isinstance(exposure.get('documentedChangeSignals'), dict) else {}
    quality = payload.get('qualitySignals') if isinstance(payload.get('qualitySignals'), dict) else {}
    uncertainty = payload.get('uncertaintySignals') if isinstance(payload.get('uncertaintySignals'), dict) else {}
    provenance = payload.get('provenance') if isinstance(payload.get('provenance'), dict) else {}
    lineage = provenance.get('lineage') if isinstance(provenance.get('lineage'), dict) else {}
    governance = payload.get('governance') if isinstance(payload.get('governance'), dict) else {}
    diagnoses = case_mix.get('diagnoses') if isinstance(case_mix.get('diagnoses'), list) else []
    risk_flags = case_mix.get('riskFlags') if isinstance(case_mix.get('riskFlags'), list) else []
    attribution = exposure.get('attribution') if isinstance(exposure.get('attribution'), dict) else {}

    grain = 'window' if context.get('grain') == 'shift' else 'episode'
    row_key = (
        identity.get('episodeId')
        or identity.get('encounterId')
        or identity.get('bundleId')
        or bridge_request.bridge_request_id
    )
    unit_id = context.get('unitId')
    window_start = context.get('windowStart')
    window_end = context.get('windowEnd')
    patient_key = identity.get('patientId') or bridge_request.patient_id
    if isinstance(patient_key, str) and patient_key.strip().lower() == 'unknown':
        patient_key = None

    clinical_timestamp = window_end or window_start or context.get('timestamp')
    recorded_timestamp = (provenance.get('generatedAt') if isinstance(provenance, dict) else None) or context.get('timestamp')
    feature_values = {
        'age_years': _optional_numeric_value(case_mix.get('ageYears')),
        'diagnosis_count': float(len(diagnoses)),
        'risk_flag_count': float(len(risk_flags)),
        'braden': _optional_numeric_value(baseline_scores.get('braden')),
        'glasgow': _optional_numeric_value(baseline_scores.get('glasgow')),
        'pain_eva': _optional_numeric_value(baseline_scores.get('painEva')),
        'avpu_score': _optional_avpu_score(baseline_scores.get('avpu')),
        'documented_medication_count': _optional_numeric_value(exposure.get('documentedMedicationCount')),
        'documented_procedure_count': _optional_numeric_value(exposure.get('documentedProcedureCount')),
        'documented_device_use_count': _optional_numeric_value(exposure.get('documentedDeviceUseCount')),
        'documented_outcome_count': _optional_numeric_value(exposure.get('documentedOutcomeCount')),
        'documented_exam_count': _optional_numeric_value(exposure.get('documentedExamCount')),
        'abnormal_vital_count': _optional_numeric_value(change_signals.get('abnormalVitalCount')),
        'severity_weight': _optional_numeric_value(exposure.get('severityWeight')),
        'exposure_share': _optional_numeric_value(exposure.get('exposureShare')),
        'structured_completeness_rate': _optional_numeric_value(quality.get('structuredCompletenessRate')),
        'bedside_checklist_completion_rate': _optional_numeric_value(quality.get('bedsideChecklistCompletionRate')),
        'missingness_rate': _optional_numeric_value(uncertainty.get('missingnessRate')),
        'support_level': _optional_numeric_value(uncertainty.get('supportLevel')),
        'stale_data': 1.0 if uncertainty.get('staleData') else 0.0,
        'insufficient_evidence': 1.0 if uncertainty.get('insufficientEvidence') else 0.0,
        'closing_summary_present': 1.0 if change_signals.get('closingSummaryPresent') else 0.0,
        'sbar_present': 1.0 if change_signals.get('sbarPresent') else 0.0,
        'shift_closure_documented': 1.0 if quality.get('shiftClosureDocumented') else 0.0,
        'documented_signature_count': _optional_numeric_value(attribution.get('signatureCount')),
        'documented_cosigner_count': _optional_numeric_value(attribution.get('documentedCoSignerCount')),
        'primary_actor_documented': 1.0 if attribution.get('primaryActorDocumented') else 0.0,
    }
    features = {key: value for key, value in feature_values.items() if value is not None}
    missingness_flags = {key: value is None for key, value in feature_values.items()}
    row = {
        'contract_version': FEATURE_CONTRACT_VERSION,
        'source_repo': FEATURE_SOURCE_REPO,
        'source_grain': grain,
        'row_id': f'{grain}:{row_key}',
        'episode_id': identity.get('episodeId') or identity.get('encounterId') or identity.get('bundleId'),
        'unit_id': unit_id,
        'clinical_timestamp': clinical_timestamp,
        'recorded_timestamp': recorded_timestamp,
        'features': features,
        'missingness_flags': missingness_flags,
        'warnings': uncertainty.get('warnings') if isinstance(uncertainty.get('warnings'), list) else [],
        'shadow_mode': True,
        'non_individual_use': True,
        'patient_key': patient_key,
        'unit_code': unit_id,
        **features,
        'window_start': window_start,
        'start_dt': window_start,
        'window_end': window_end,
        'end_dt': window_end,
        'shift': context.get('shift'),
        'lineage': {
            'request_id': identity.get('requestId') or bridge_request.request_id,
            'bundle_id': identity.get('bundleId') or bridge_request.bundle_id,
            'patient_id': identity.get('patientId') or bridge_request.patient_id,
            'encounter_id': identity.get('encounterId') or bridge_request.encounter_id,
            'composition_id': identity.get('compositionId') or bridge_request.composition_id,
            'source_contract_version': payload.get('contractVersion'),
            'contextual_contract_version': contextual_signal.get('contract_version'),
            'contextual_signal_present': bool(contextual_signal),
            'contextual_signal': contextual_signal or None,
            'request_hash': bridge_request.payload_hash,
            'bridge_request_id': bridge_request.bridge_request_id,
            'display_policy': governance.get('displayPolicy'),
            'staff_identifiers_redacted': bool(governance.get('staffIdentifiersRedacted', True)),
            'source': lineage,
        },
    }
    return {key: value for key, value in row.items() if value not in (None, '', {})}


def _validate_icea_plus_score_request_contract(payload: dict[str, Any]) -> dict[str, Any]:
    rows = payload.get('rows')
    if payload.get('contract_version') != FEATURE_CONTRACT_VERSION:
        raise IceaPipelineConfigurationError('invalid_feature_contract')
    if payload.get('source_repo') != FEATURE_SOURCE_REPO:
        raise IceaPipelineConfigurationError('invalid_feature_source_repo')
    if payload.get('shadow_mode') is not True or payload.get('non_individual_use') is not True:
        raise IceaPipelineConfigurationError('invalid_feature_governance')
    if not isinstance(rows, list) or len(rows) != 1:
        raise IceaPipelineConfigurationError('invalid_feature_rows')
    row = rows[0]
    if not isinstance(row, dict):
        raise IceaPipelineConfigurationError('invalid_feature_row')
    for key in (
        'contract_version',
        'source_repo',
        'source_grain',
        'row_id',
        'episode_id',
        'unit_id',
        'clinical_timestamp',
        'recorded_timestamp',
        'features',
        'missingness_flags',
        'warnings',
        'shadow_mode',
        'non_individual_use',
    ):
        if key not in row:
            raise IceaPipelineConfigurationError(f'missing_feature_contract_field:{key}')
    if row.get('contract_version') != FEATURE_CONTRACT_VERSION or row.get('source_repo') != FEATURE_SOURCE_REPO:
        raise IceaPipelineConfigurationError('invalid_feature_row_contract')
    if row.get('source_grain') != payload.get('grain'):
        raise IceaPipelineConfigurationError('feature_grain_mismatch')
    if not isinstance(row.get('features'), dict) or not isinstance(row.get('missingness_flags'), dict):
        raise IceaPipelineConfigurationError('invalid_feature_payload')
    if row.get('shadow_mode') is not True or row.get('non_individual_use') is not True:
        raise IceaPipelineConfigurationError('invalid_feature_row_governance')
    return payload


def _optional_numeric_value(value: Any) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _optional_avpu_score(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    return _avpu_score(value)


def _avpu_score(value: Any) -> float:
    mapping = {'A': 0.0, 'C': 0.0, 'V': 1.0, 'P': 2.0, 'U': 3.0}
    if isinstance(value, str):
        return mapping.get(value.strip().upper(), 0.0)
    return 0.0


class IceaBridgeRemoteService:
    def __init__(self, settings_obj: IceaBridgeSettings | None = None, pipeline_service: IceaPipelineService | None = None):
        self.settings = settings_obj or load_icea_bridge_settings()
        self.pipeline_service = pipeline_service or IceaPipelineService()

    def submit_score(self, bridge_request: IceaBridgeRequest) -> IceaBridgeRemoteResponse:
        return self._request(
            'POST',
            self.settings.score_path,
            json_body=_build_icea_plus_score_request(bridge_request, self.settings),
            idempotency_key=bridge_request.idempotency_key,
        )

    def get_status(self, bridge_request: IceaBridgeRequest) -> IceaBridgeRemoteResponse:
        if not self.settings.has_remote_status:
            raise IceaPipelineConfigurationError('icea_bridge_status_not_configured')
        return self._request(
            'GET',
            self.settings.status_path,
            params={
                'requestId': bridge_request.request_id,
                'bridgeRequestId': bridge_request.bridge_request_id,
                'bundleId': bridge_request.bundle_id,
                'patientId': bridge_request.patient_id,
                'scoringMode': bridge_request.scoring_mode,
            },
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> IceaBridgeRemoteResponse:
        if not self.settings.enabled:
            raise IceaPipelineConfigurationError('icea_bridge_disabled')
        if not path:
            raise IceaPipelineConfigurationError('icea_bridge_path_not_configured')
        url = f"{self.pipeline_service.settings.base_url.rstrip('/')}{path if path.startswith('/') else '/' + path}"
        headers = {
            'Accept': 'application/json',
            'Authorization': f"Bearer {self.pipeline_service._get_access_token()}",
        }
        if json_body is not None:
            headers['Content-Type'] = 'application/json'
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
        try:
            response = httpx.request(
                method,
                url,
                params=params,
                json=json_body,
                headers=headers,
                timeout=max(self.settings.timeout_ms / 1000.0, 0.1),
                verify=self.pipeline_service.settings.verify_tls,
            )
        except httpx.HTTPError as exc:
            raise IceaPipelineTransportError(exc.__class__.__name__) from exc
        body_json = _parse_json_body(response)
        if response.status_code >= 400:
            raise IceaPipelineHTTPStatusError(_remote_detail(body_json) or f'http_{response.status_code}', http_status=response.status_code)
        return IceaBridgeRemoteResponse(status_code=response.status_code, body_json=body_json)


def attempt_icea_bridge_delivery(bridge_request: IceaBridgeRequest, *, force: bool = False) -> IceaBridgeDeliveryResult:
    settings = load_icea_bridge_settings()
    bridge_request = expire_icea_bridge_request_if_due(_current_bridge_request(bridge_request.id) or bridge_request)
    if not settings.enabled or not settings.allows_mode(bridge_request.scoring_mode):
        return IceaBridgeDeliveryResult(delivered=False, status='disabled', detail='bridge_disabled')
    configuration_error = _score_configuration_error(settings, scoring_mode=bridge_request.scoring_mode)
    if configuration_error not in (None, 'icea_bridge_disabled'):
        return _mark_failed(bridge_request, detail=configuration_error)
    if bridge_request.status == IceaBridgeRequest.STATUS_SCORED and not force:
        return IceaBridgeDeliveryResult(delivered=True, status=bridge_request.status, detail='already_scored')
    if bridge_request.status == IceaBridgeRequest.STATUS_STALE and not force:
        return IceaBridgeDeliveryResult(
            delivered=False,
            status=bridge_request.status,
            http_status=bridge_request.last_http_status,
            detail=bridge_request.last_error or 'delivery_skipped',
        )
    now = timezone.now()
    if not force and bridge_request.next_retry_at and bridge_request.next_retry_at > now:
        return IceaBridgeDeliveryResult(
            delivered=False,
            status=bridge_request.status,
            http_status=bridge_request.last_http_status,
            detail='retry_waiting',
        )

    while True:
        sent_payload_hash = bridge_request.payload_hash
        sent_idempotency_key = bridge_request.idempotency_key
        sent_at = timezone.now()
        send_query = IceaBridgeRequest.objects.filter(
            id=bridge_request.id,
            payload_hash=sent_payload_hash,
            idempotency_key=sent_idempotency_key,
        )
        if not force:
            send_query = send_query.filter(status=IceaBridgeRequest.STATUS_QUEUED)
        updated = send_query.update(
            attempts=F('attempts') + 1,
            status=IceaBridgeRequest.STATUS_SENT,
            next_retry_at=None,
            sent_at=sent_at,
            updated_at=sent_at,
        )
        if updated:
            bridge_request = _current_bridge_request(bridge_request.id) or bridge_request
            break

        latest_bridge_request = _current_bridge_request(bridge_request.id)
        if latest_bridge_request is None:
            return IceaBridgeDeliveryResult(delivered=False, status='missing', detail='not_found')
        if latest_bridge_request.status == IceaBridgeRequest.STATUS_SCORED and not force:
            return IceaBridgeDeliveryResult(delivered=True, status=latest_bridge_request.status, detail='already_scored')
        if not force and latest_bridge_request.status != IceaBridgeRequest.STATUS_QUEUED:
            return IceaBridgeDeliveryResult(
                delivered=latest_bridge_request.status == IceaBridgeRequest.STATUS_SCORED,
                status=latest_bridge_request.status,
                detail='delivery_skipped',
            )
        if _bridge_request_matches_delivery(
            latest_bridge_request,
            expected_payload_hash=sent_payload_hash,
            expected_idempotency_key=sent_idempotency_key,
        ):
            return IceaBridgeDeliveryResult(
                delivered=latest_bridge_request.status == IceaBridgeRequest.STATUS_SCORED,
                status=latest_bridge_request.status,
                detail='delivery_skipped',
            )
        bridge_request = latest_bridge_request

    service = IceaBridgeRemoteService(settings_obj=settings)
    try:
        response = service.submit_score(bridge_request)
    except IceaPipelineConfigurationError as exc:
        return _mark_failed(
            bridge_request,
            detail=exc.detail,
            expected_payload_hash=sent_payload_hash,
            expected_idempotency_key=sent_idempotency_key,
        )
    except IceaPipelineTransportError as exc:
        if bridge_request.attempts < settings.retry_max:
            return _schedule_retry(
                bridge_request,
                settings=settings,
                detail=exc.detail,
                expected_payload_hash=sent_payload_hash,
                expected_idempotency_key=sent_idempotency_key,
            )
        return _mark_failed(
            bridge_request,
            detail=exc.detail,
            expected_payload_hash=sent_payload_hash,
            expected_idempotency_key=sent_idempotency_key,
        )
    except IceaPipelineHTTPStatusError as exc:
        if exc.http_status in settings.retryable_status_codes and bridge_request.attempts < settings.retry_max:
            return _schedule_retry(
                bridge_request,
                settings=settings,
                detail=exc.detail,
                http_status=exc.http_status,
                expected_payload_hash=sent_payload_hash,
                expected_idempotency_key=sent_idempotency_key,
            )
        return _mark_failed(
            bridge_request,
            detail=exc.detail,
            http_status=exc.http_status,
            expected_payload_hash=sent_payload_hash,
            expected_idempotency_key=sent_idempotency_key,
        )
    result = _apply_remote_payload(
        bridge_request,
        response.body_json,
        response.status_code,
        expected_payload_hash=sent_payload_hash,
        expected_idempotency_key=sent_idempotency_key,
    )
    if result.status in {
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
    }:
        schedule_icea_bridge_resolution(
            bridge_request.id,
            expected_payload_hash=sent_payload_hash,
            expected_idempotency_key=sent_idempotency_key,
            delay_seconds=settings.stale_after_seconds,
        )
    return result


def refresh_icea_bridge_request(bridge_request: IceaBridgeRequest) -> IceaBridgeDeliveryResult:
    bridge_request = expire_icea_bridge_request_if_due(_current_bridge_request(bridge_request.id) or bridge_request)
    settings = load_icea_bridge_settings()
    if not settings.enabled or bridge_request.status not in {
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
        IceaBridgeRequest.STATUS_STALE,
    }:
        return IceaBridgeDeliveryResult(delivered=bridge_request.status == IceaBridgeRequest.STATUS_SCORED, status=bridge_request.status)
    if bridge_request.status == IceaBridgeRequest.STATUS_STALE and bridge_request.last_error == REMOTE_STATUS_TIMEOUT_ERROR:
        return IceaBridgeDeliveryResult(
            delivered=False,
            status=bridge_request.status,
            http_status=bridge_request.last_http_status,
            detail=bridge_request.last_error,
        )
    if not settings.has_remote_status:
        raise IceaPipelineConfigurationError('icea_bridge_status_not_configured')
    service = IceaBridgeRemoteService(settings_obj=settings)
    expected_payload_hash = bridge_request.payload_hash
    expected_idempotency_key = bridge_request.idempotency_key
    response = service.get_status(bridge_request)
    result = _apply_remote_payload(
        bridge_request,
        response.body_json,
        response.status_code,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    )
    if result.status in {
        IceaBridgeRequest.STATUS_ACCEPTED,
        IceaBridgeRequest.STATUS_PENDING,
    }:
        schedule_icea_bridge_resolution(
            bridge_request.id,
            expected_payload_hash=expected_payload_hash,
            expected_idempotency_key=expected_idempotency_key,
            delay_seconds=settings.stale_after_seconds,
        )
    return result


def deliver_icea_bridge_request(bridge_request_id: int, *, force: bool = False) -> IceaBridgeDeliveryResult:
    bridge_request = IceaBridgeRequest.objects.filter(id=bridge_request_id).first()
    if bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', detail='not_found')
    bridge_request = expire_icea_bridge_request_if_due(bridge_request)
    return attempt_icea_bridge_delivery(bridge_request, force=force)


def _apply_remote_payload(
    bridge_request: IceaBridgeRequest,
    body_json: dict[str, Any] | list[Any] | None,
    http_status: int,
    *,
    expected_payload_hash: str | None = None,
    expected_idempotency_key: str | None = None,
) -> IceaBridgeDeliveryResult:
    current_bridge_request = _current_bridge_request(bridge_request.id)
    if current_bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if expected_payload_hash is not None and expected_idempotency_key is not None and not _bridge_request_matches_delivery(
        current_bridge_request,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    ):
        return _stale_delivery_result(current_bridge_request, http_status=http_status)
    bridge_request = current_bridge_request
    normalized = _normalize_remote_payload(
        body_json,
        bridge_request=bridge_request,
        http_status=http_status,
        stale_after_seconds=load_icea_bridge_settings().stale_after_seconds,
    )
    received_at = timezone.now()
    persistence = _persist_bridge_request_update(
        bridge_request.id,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
        updated_at=received_at,
        update_fields={
            'status': normalized['status'],
            'provisional': normalized['provisional'],
            'insufficient_evidence': normalized['insufficientEvidence'],
            'formula_version': normalized['formulaVersion'],
            'contract_version': normalized['contractVersion'],
            'score_summary_json': normalized['scoreSummary'],
            'warnings_json': normalized['warnings'],
            'remote_refs_json': normalized['remoteRefs'],
            'last_error': '',
            'last_http_status': http_status,
            'next_retry_at': None,
            'received_at': received_at,
        },
    )
    if persistence.bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if not persistence.updated:
        return _stale_delivery_result(persistence.bridge_request, http_status=http_status)
    bridge_request = persistence.bridge_request
    return IceaBridgeDeliveryResult(
        delivered=bridge_request.status == IceaBridgeRequest.STATUS_SCORED,
        status=bridge_request.status,
        http_status=http_status,
        detail='ok',
    )


def _mark_failed(
    bridge_request: IceaBridgeRequest,
    *,
    detail: str,
    http_status: int | None = None,
    expected_payload_hash: str | None = None,
    expected_idempotency_key: str | None = None,
) -> IceaBridgeDeliveryResult:
    current_bridge_request = _current_bridge_request(bridge_request.id)
    if current_bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if expected_payload_hash is not None and expected_idempotency_key is not None and not _bridge_request_matches_delivery(
        current_bridge_request,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
    ):
        return _stale_delivery_result(current_bridge_request, http_status=http_status)
    bridge_request = current_bridge_request
    received_at = timezone.now()
    persistence = _persist_bridge_request_update(
        bridge_request.id,
        expected_payload_hash=expected_payload_hash,
        expected_idempotency_key=expected_idempotency_key,
        updated_at=received_at,
        update_fields={
            'status': IceaBridgeRequest.STATUS_FAILED,
            'last_error': (detail or '')[:255],
            'last_http_status': http_status,
            'next_retry_at': None,
            'received_at': received_at,
        },
    )
    if persistence.bridge_request is None:
        return IceaBridgeDeliveryResult(delivered=False, status='missing', http_status=http_status, detail='not_found')
    if not persistence.updated:
        return _stale_delivery_result(persistence.bridge_request, http_status=http_status)
    bridge_request = persistence.bridge_request
    return IceaBridgeDeliveryResult(delivered=False, status=bridge_request.status, http_status=http_status, detail=bridge_request.last_error)


def _normalize_remote_payload(
    body_json: dict[str, Any] | list[Any] | None,
    *,
    bridge_request: IceaBridgeRequest,
    http_status: int,
    stale_after_seconds: int,
) -> dict[str, Any]:
    payload = body_json if isinstance(body_json, dict) else {}
    summary_payload = payload.get('summary') if isinstance(payload.get('summary'), dict) else {}
    results = payload.get('results') if isinstance(payload.get('results'), list) else []
    first_result = next((item for item in results if isinstance(item, dict)), {})
    raw_status = str(payload.get('status') or payload.get('state') or payload.get('result') or '').strip().lower()
    result_status = str(first_result.get('status') or '').strip().lower()
    non_scoring_status = raw_status in NON_SCORING_REMOTE_STATUSES or result_status in NON_SCORING_REMOTE_STATUSES

    score_summary = None
    if non_scoring_status:
        score_summary = None
    elif isinstance(payload.get('scoreSummary'), dict):
        score_summary = payload.get('scoreSummary')
    elif isinstance(payload.get('summary'), dict) and not results:
        score_summary = payload.get('summary')
    elif 'score' in payload:
        score_summary = {'score': payload.get('score')}
    elif first_result:
        score_summary = {
            'score': first_result.get('score'),
            'rawScore': first_result.get('raw_score'),
            'rowStatus': first_result.get('status'),
            'confidence': first_result.get('confidence'),
            'components': first_result.get('components'),
            'rowsRequested': summary_payload.get('rows_requested'),
            'rowsScored': summary_payload.get('rows_scored'),
            'statusCounts': summary_payload.get('status_counts'),
            'componentMeans': summary_payload.get('component_means'),
        }

    status = IceaBridgeRequest.STATUS_SENT
    if raw_status in {'accepted', 'queued'}:
        status = IceaBridgeRequest.STATUS_ACCEPTED
    elif raw_status in {'pending', 'running', 'processing'}:
        status = IceaBridgeRequest.STATUS_PENDING
    elif raw_status in {'scored', 'complete', 'completed', 'succeeded', 'success'}:
        status = IceaBridgeRequest.STATUS_SCORED
    elif raw_status == 'stale':
        status = IceaBridgeRequest.STATUS_STALE
    elif non_scoring_status:
        status = IceaBridgeRequest.STATUS_FAILED
    elif result_status in {'complete', 'completed', 'provisional', 'insufficient_evidence'}:
        status = IceaBridgeRequest.STATUS_SCORED
    elif score_summary is not None:
        status = IceaBridgeRequest.STATUS_SCORED
    elif http_status == 202:
        status = IceaBridgeRequest.STATUS_ACCEPTED

    warnings = []
    raw_warnings = payload.get('warnings') or payload.get('issues') or summary_payload.get('warnings') or first_result.get('warnings') or []
    if isinstance(raw_warnings, list):
        for item in raw_warnings:
            if isinstance(item, dict):
                warnings.append(item)
            elif isinstance(item, str) and item.strip():
                warnings.append({'code': 'remote_warning', 'message': item.strip()})

    flags = first_result.get('flags') if isinstance(first_result.get('flags'), dict) else {}
    if flags.get('insufficient_evidence') and not any(item.get('code') == 'insufficient_evidence' for item in warnings if isinstance(item, dict)):
        warnings.append({'code': 'insufficient_evidence', 'message': 'ICEA+ marked the score as insufficient evidence.'})
    if flags.get('missing_key_inputs'):
        warnings.append({'code': 'missing_key_inputs', 'message': 'ICEA+ reported missing key inputs for scoring.'})
    if flags.get('high_uncertainty'):
        warnings.append({'code': 'high_uncertainty', 'message': 'ICEA+ reported high uncertainty for this score.'})
    if non_scoring_status:
        warning_code = result_status if result_status in NON_SCORING_REMOTE_STATUSES else raw_status
        if not any(item.get('code') == warning_code for item in warnings if isinstance(item, dict)):
            warnings.append({'code': warning_code, 'message': f'ICEA+ did not produce an individual score: {warning_code}.'})

    insufficient_evidence = (
        bool(payload.get('insufficientEvidence'))
        or bool(flags.get('insufficient_evidence'))
        or result_status == 'insufficient_evidence'
        or non_scoring_status
        or any(
            str(item.get('code') or '').strip().lower() == 'insufficient_evidence'
            for item in warnings
            if isinstance(item, dict)
        )
    )
    if status == IceaBridgeRequest.STATUS_SENT and bridge_request.updated_at < timezone.now() - datetime.timedelta(seconds=stale_after_seconds):
        status = IceaBridgeRequest.STATUS_STALE

    provisional = (
        bool(payload.get('provisional'))
        if isinstance(payload.get('provisional'), bool)
        else bool(first_result.get('provisional'))
        if isinstance(first_result.get('provisional'), bool)
        else result_status == 'provisional' or bridge_request.scoring_mode == IceaBridgeRequest.SCORING_MODE_IMMEDIATE
    )
    formula_version = str(payload.get('formulaVersion') or payload.get('formula_version') or '')[:64]

    remote_refs = {
        key: payload[key]
        for key in ('requestId', 'jobId', 'resultId', 'summaryId', 'bundleId', 'patientId', 'formula_protocol_hash')
        if key in payload and payload[key] not in (None, '')
    }
    model_payload = payload.get('model') if isinstance(payload.get('model'), dict) else {}
    if model_payload.get('id'):
        remote_refs['modelId'] = model_payload.get('id')
    if model_payload.get('version'):
        remote_refs['modelVersion'] = model_payload.get('version')

    return {
        'status': status,
        'provisional': provisional,
        'insufficientEvidence': insufficient_evidence,
        'formulaVersion': formula_version,
        'contractVersion': str(payload.get('contractVersion') or payload.get('contract_version') or bridge_request.contract_version or CONTRACT_VERSION)[:64],
        'scoreSummary': score_summary,
        'warnings': warnings,
        'remoteRefs': remote_refs,
    }


def _parse_json_body(response: httpx.Response) -> dict[str, Any] | list[Any] | None:
    if response.status_code == 204:
        return None
    raw_text = response.text.strip()
    if not raw_text:
        return None
    content_type = str(response.headers.get('Content-Type') or '').lower()
    if 'json' not in content_type and not raw_text.startswith('{') and not raw_text.startswith('['):
        return None
    try:
        parsed = response.json()
    except ValueError:
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


def _remote_detail(body_json: dict[str, Any] | list[Any] | None) -> str:
    if isinstance(body_json, dict):
        for key in ('detail', 'error', 'message', 'code', 'status'):
            value = body_json.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:255]
    return ''


def _deliver_in_thread(bridge_request_id: int, force: bool, delay_seconds: float = 0.0) -> None:
    close_old_connections()
    try:
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        deliver_icea_bridge_request(bridge_request_id, force=force)
    finally:
        close_old_connections()


def _resolve_in_thread(
    bridge_request_id: int,
    *,
    expected_payload_hash: str,
    expected_idempotency_key: str,
    delay_seconds: float,
) -> None:
    close_old_connections()
    try:
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        expire_icea_bridge_request(
            bridge_request_id,
            expected_payload_hash=expected_payload_hash,
            expected_idempotency_key=expected_idempotency_key,
        )
    finally:
        close_old_connections()


def schedule_icea_bridge_delivery(bridge_request_id: int, *, force: bool = False, delay_seconds: float = 0.0) -> None:
    if _running_tests():
        deliver_icea_bridge_request(bridge_request_id, force=force or delay_seconds > 0)
        return
    thread = threading.Thread(
        target=_deliver_in_thread,
        kwargs={'bridge_request_id': bridge_request_id, 'force': force, 'delay_seconds': delay_seconds},
        name=f'icea-bridge-{bridge_request_id}',
        daemon=True,
    )
    thread.start()


def schedule_icea_bridge_resolution(
    bridge_request_id: int,
    *,
    expected_payload_hash: str,
    expected_idempotency_key: str,
    delay_seconds: float,
) -> None:
    if _running_tests():
        return
    thread = threading.Thread(
        target=_resolve_in_thread,
        kwargs={
            'bridge_request_id': bridge_request_id,
            'expected_payload_hash': expected_payload_hash,
            'expected_idempotency_key': expected_idempotency_key,
            'delay_seconds': delay_seconds,
        },
        name=f'icea-bridge-resolve-{bridge_request_id}',
        daemon=True,
    )
    thread.start()


def serialize_bridge_request(bridge_request: IceaBridgeRequest) -> dict[str, Any]:
    bridge_request = expire_icea_bridge_request_if_due(bridge_request)
    retry_scheduled = bridge_request.status == IceaBridgeRequest.STATUS_QUEUED and bridge_request.next_retry_at is not None
    payload = bridge_request.payload_json if isinstance(bridge_request.payload_json, dict) else {}
    governance = payload.get('governance') if isinstance(payload.get('governance'), dict) else {}
    return {
        'id': bridge_request.id,
        'bridgeRequestId': bridge_request.bridge_request_id,
        'handoverId': bridge_request.bundle_id,
        'bundleId': bridge_request.bundle_id,
        'requestId': bridge_request.request_id,
        'patientId': bridge_request.patient_id,
        'unitId': bridge_request.unit_id,
        'encounterId': bridge_request.encounter_id or None,
        'compositionId': bridge_request.composition_id or None,
        'episodeId': bridge_request.episode_id or None,
        'shift': bridge_request.shift or None,
        'status': bridge_request.status,
        'scoringMode': bridge_request.scoring_mode,
        'payloadHash': bridge_request.payload_hash,
        'idempotencyKey': bridge_request.idempotency_key,
        'contractVersion': bridge_request.contract_version or None,
        'formulaVersion': bridge_request.formula_version or None,
        'provisional': bridge_request.provisional,
        'insufficientEvidence': bridge_request.insufficient_evidence,
        'scoreSummary': None,
        'scoreSummaryRedacted': bridge_request.score_summary_json is not None,
        'warnings': bridge_request.warnings_json or [],
        'attempts': bridge_request.attempts,
        'terminal': _is_terminal_status(bridge_request.status),
        'retryScheduled': retry_scheduled,
        'remoteRefs': bridge_request.remote_refs_json or {},
        'lastError': bridge_request.last_error or None,
        'lastHttpStatus': bridge_request.last_http_status,
        'source': SOURCE,
        'lastAttemptAt': bridge_request.sent_at.isoformat() if bridge_request.sent_at else None,
        'nextRetryAt': bridge_request.next_retry_at.isoformat() if bridge_request.next_retry_at else None,
        'sentAt': bridge_request.sent_at.isoformat() if bridge_request.sent_at else None,
        'receivedAt': bridge_request.received_at.isoformat() if bridge_request.received_at else None,
        'displayPolicy': str(governance.get('displayPolicy') or 'shadow_aggregated_no_individual_score'),
        'staffIdentifiersRedacted': bool(governance.get('staffIdentifiersRedacted', True)),
        'individualScoreVisible': False,
        'causalSummaryVisible': False,
        'createdAt': bridge_request.created_at.isoformat(),
        'updatedAt': bridge_request.updated_at.isoformat(),
    }


def serialize_bridge_summary(bridge_request: IceaBridgeRequest) -> dict[str, Any]:
    bridge_request = expire_icea_bridge_request_if_due(bridge_request)
    payload = bridge_request.payload_json if isinstance(bridge_request.payload_json, dict) else {}
    governance = payload.get('governance') if isinstance(payload.get('governance'), dict) else {}
    return {
        'handoverId': bridge_request.bundle_id,
        'status': bridge_request.status,
        'scoringMode': bridge_request.scoring_mode,
        'provisional': bridge_request.provisional,
        'insufficientEvidence': bridge_request.insufficient_evidence,
        'scoreSummary': None,
        'scoreSummaryRedacted': bridge_request.score_summary_json is not None,
        'warnings': bridge_request.warnings_json or [],
        'formulaVersion': bridge_request.formula_version or None,
        'displayPolicy': str(governance.get('displayPolicy') or 'shadow_aggregated_no_individual_score'),
        'staffIdentifiersRedacted': bool(governance.get('staffIdentifiersRedacted', True)),
        'individualScoreVisible': False,
        'causalSummaryVisible': False,
        'lastUpdated': bridge_request.updated_at.isoformat(),
        'source': SOURCE,
    }
