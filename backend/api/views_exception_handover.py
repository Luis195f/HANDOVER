from __future__ import annotations

import hashlib
import json
import random
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, OperationalError, connection, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.api.clinical_storage import ClinicalBundleStorageError, decrypt_bundle_document, encrypt_bundle_document
from backend.api.models import ExceptionHandoverShift, Patient
from backend.api.pilot_control import exception_handover_test_enabled
from backend.api.views import _resolve_unit_scope
from backend.security.auth import Auth0JWTAuthentication
from backend.security.permissions_roles import HasAnyRole
from backend.security.scope_permissions import HasAllScopes


def _enabled() -> bool:
    return exception_handover_test_enabled()


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def _receipt_domain(value: object) -> bool:
    if value is None or isinstance(value, (str, bool)):
        return True
    if isinstance(value, int):
        return abs(value) <= 9007199254740991
    if isinstance(value, list):
        return all(_receipt_domain(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _receipt_domain(item) for key, item in value.items())
    return False


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _scope(request, unit_id: str):
    _, error = _resolve_unit_scope(request, requested_unit=unit_id,
        scope_unavailable_detail='Unit scope unavailable.', scope_unavailable_code='unit_scope_unavailable',
        forbidden_detail='Unit not authorized.', forbidden_code='unit_forbidden',
        required_unit_detail='Unit required.', required_unit_code='unit_required')
    return error


def _actor(request) -> str:
    return str(getattr(request.user, 'sub', '') or '')


def _read(record: ExceptionHandoverShift) -> dict:
    return decrypt_bundle_document(record.state_json, encryption_metadata=record.encryption_metadata)


def _public(record: ExceptionHandoverShift, *, include_state: bool = False) -> dict:
    result = {'id': str(record.id), 'unitId': record.unit_id,
              'periodStart': record.period_start.isoformat(), 'periodEnd': record.period_end.isoformat(),
              'description': record.description, 'creatorSub': record.creator_sub,
              'revision': record.revision, 'expiresAt': record.expires_at.isoformat()}
    if include_state:
        state = _read(record)
        state.pop('_operations', None)
        result['state'] = state
    return result


def _prior_references(unit_id: str) -> list[dict]:
    now = timezone.now()
    latest: dict[tuple[str, str], dict] = {}
    shifts = ExceptionHandoverShift.objects.filter(unit_id=unit_id, expires_at__gt=now).order_by('-created_at')
    for prior in shifts:
        for reference in _read(prior).get('acceptedReferences', []):
            expires_at = parse_datetime(str(reference.get('expiresAt', '')))
            if not expires_at or timezone.is_naive(expires_at) or expires_at <= now:
                continue
            for snapshot in reference.get('snapshots', []):
                key = (str(snapshot.get('patientId')), str(snapshot.get('unitId')))
                previous = latest.get(key)
                if not previous or reference['acceptedAt'] > previous['acceptedAt']:
                    latest[key] = reference
    return list({reference['incomingKey']: reference for reference in latest.values()}.values())


def _patient_ids_valid(unit_id: str, previous: dict, state: dict) -> bool:
    patient_ids = set()
    old_drafts = previous.get('briefDrafts', {})
    new_drafts = state.get('briefDrafts', {})
    patient_ids.update(str(patient_id) for patient_id in old_drafts.keys() | new_drafts.keys()
                       if old_drafts.get(patient_id) != new_drafts.get(patient_id))
    for override in state.get('overrides', [])[len(previous.get('overrides', [])):]:
        if override.get('patientId'):
            patient_ids.add(str(override['patientId']))
    for event in state.get('events', [])[len(previous.get('events', [])):]:
        if event.get('patientId'):
            patient_ids.add(str(event['patientId']))
    manifest = state.get('frozenManifest')
    if manifest and manifest != previous.get('frozenManifest'):
        for snapshot in manifest.get('snapshots', []):
            if snapshot.get('unitId') != unit_id:
                return False
            patient_ids.add(str(snapshot.get('patientId', '')))
    for patient_id in patient_ids:
        matches = Patient.objects.filter(unit=unit_id, active=True)
        matches = matches.filter(id=int(patient_id)) if patient_id.isdecimal() else \
            matches.filter(external_fhir_id=patient_id)
        if matches.count() != 1:
            return False
    return True


def _manifest_valid(manifest: object, record: ExceptionHandoverShift) -> bool:
    if not isinstance(manifest, dict):
        return False
    context, snapshots = manifest.get('context'), manifest.get('snapshots')
    if not isinstance(context, dict) or context.get('shiftId') != str(record.id) or \
            not isinstance(snapshots, list) or not snapshots:
        return False
    members = [(snapshot.get('patientId'), snapshot.get('unitId')) for snapshot in snapshots
               if isinstance(snapshot, dict)]
    return len(members) == len(snapshots) and all(isinstance(patient_id, str) and patient_id and
        isinstance(unit_id, str) for patient_id, unit_id in members) and \
        len(set(members)) == len(members) and \
        all(unit_id == record.unit_id for _, unit_id in members) and \
        all(snapshot.get('shiftId') == str(record.id) for snapshot in snapshots) and \
        manifest.get('hash') == _digest(snapshots)


def _transition(previous: dict, proposed: dict, record: ExceptionHandoverShift, actor: str) -> str | None:
    if proposed.get('version') != 2 or proposed.get('shiftId') != str(record.id):
        return 'state_invalid'
    if not isinstance(proposed.get('briefDrafts'), dict) or \
            not isinstance(proposed.get('interactionCounts'), dict):
        return 'state_invalid'
    for field in ('events', 'overrides'):
        old, new = previous.get(field, []), proposed.get(field)
        if not isinstance(new, list) or new[:len(old)] != old:
            return 'history_modified'
    old_references = {reference['incomingKey']: reference for reference in previous.get('acceptedReferences', [])}
    submitted_references = proposed.get('acceptedReferences')
    if not isinstance(submitted_references, list) or any(not isinstance(reference, dict) for reference in submitted_references) or any(
        old_references.get(reference.get('incomingKey'), reference) != reference
        for reference in submitted_references):
        return 'history_modified'
    proposed['acceptedReferences'] = list(old_references.values()) + [reference for reference in submitted_references
        if isinstance(reference, dict) and reference.get('incomingKey') not in old_references]
    new_events = proposed['events'][len(previous.get('events', [])):]
    new_overrides = proposed['overrides'][len(previous.get('overrides', [])):]
    new_references = proposed['acceptedReferences'][len(old_references):]
    if len(new_events) > 2 or len(new_overrides) > 1 or len(new_references) > 1:
        return 'transition_invalid'
    actor_kind = 'outgoing' if actor == record.creator_sub else 'incoming'
    frozen = proposed.get('frozenManifest')
    if frozen is not None and not _manifest_valid(frozen, record):
        return 'manifest_invalid'
    previous_keys = {event.get('idempotencyKey') for event in previous.get('events', [])}
    for event in new_events:
        if not isinstance(event, dict) or event.get('shiftId') != str(record.id) or \
                event.get('actorId') != actor or event.get('actorKind') != actor_kind or \
                not event.get('idempotencyKey') or event['idempotencyKey'] in previous_keys:
            return 'event_invalid'
        previous_keys.add(event['idempotencyKey'])
        event['actorName'] = actor
        recorded_at = parse_datetime(str(event.get('recordedAt', '')))
        if not recorded_at or timezone.is_naive(recorded_at) or recorded_at > timezone.now() + timedelta(minutes=1):
            return 'event_time_invalid'
        if event.get('kind') == 'outgoing_transfer' and actor_kind != 'outgoing':
            return 'actor_invalid'
        if event.get('kind') == 'incoming_attestation' and actor_kind != 'incoming':
            return 'actor_invalid'
        if event.get('kind') == 'incoming_attestation' and not new_references:
            return 'acceptance_invalid'
        if event.get('kind') == 'r_transferred':
            target_at = parse_datetime(str(event.get('targetAt', '')))
            if not event.get('patientId') or not str(event.get('reason') or '').strip() or \
                    event.get('receiverId') != actor or not target_at or timezone.is_naive(target_at):
                return 'transfer_invalid'
        if event.get('kind') == 'outgoing_transfer' and (
            not frozen or event.get('manifestHash') != frozen.get('hash') or
            event.get('context') != frozen.get('context')):
            return 'manifest_invalid'
    for override in new_overrides:
        if not isinstance(override, dict) or override.get('professionalId') != actor or \
                override.get('shiftId') != str(record.id) or override.get('newLane') != 'A' or \
                not str(override.get('reason') or '').strip() or \
                not override.get('patientId'):
            return 'override_invalid'
        override_at = parse_datetime(str(override.get('recordedAt', '')))
        if not override_at or timezone.is_naive(override_at) or \
                override_at > timezone.now() + timedelta(minutes=1):
            return 'override_invalid'
        override['professionalName'] = actor
    if new_references:
        incoming = next((event for event in new_events if event.get('kind') == 'incoming_attestation'), None)
        outgoing = next((event for event in previous.get('events', []) if
                         event.get('kind') == 'outgoing_transfer' and
                         event.get('idempotencyKey') == incoming.get('acknowledgesKey')), None) if incoming else None
        reference = new_references[0]
        if not outgoing or outgoing.get('actorId') == actor or not isinstance(reference, dict) or \
                reference.get('incomingKey') != incoming.get('idempotencyKey') or \
                reference.get('outgoingKey') != outgoing.get('idempotencyKey') or \
                reference.get('manifestHash') != outgoing.get('manifestHash') or \
                incoming.get('manifestHash') != outgoing.get('manifestHash') or \
                reference.get('acceptedBy') != actor or reference.get('acceptedAt') != incoming.get('recordedAt'):
            return 'acceptance_invalid'
        prior_manifest = previous.get('frozenManifest')
        accepted_at = parse_datetime(str(reference.get('acceptedAt', '')))
        expires_at = parse_datetime(str(reference.get('expiresAt', '')))
        if not _manifest_valid(prior_manifest, record) or proposed.get('frozenManifest') is not None or \
                reference.get('context') != prior_manifest.get('context') or \
                incoming.get('context') != prior_manifest.get('context') or \
                reference.get('snapshots') != prior_manifest.get('snapshots') or \
                not accepted_at or not expires_at or timezone.is_naive(expires_at) or \
                accepted_at < parse_datetime(str(outgoing.get('recordedAt', ''))) or \
                expires_at <= accepted_at or \
                expires_at > accepted_at + timedelta(days=min(settings.HANDOVER_BUNDLE_RETENTION_DAYS, 30)):
            return 'acceptance_invalid'
    for reference in new_references:
        expires_at = parse_datetime(str(reference.get('expiresAt', '')))
        if not expires_at or timezone.is_naive(expires_at) or expires_at <= timezone.now():
            return 'acceptance_invalid'
    if not _patient_ids_valid(record.unit_id, previous, proposed):
        return 'patient_scope_invalid'
    return None


class ExceptionHandoverBase(APIView):
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [IsAuthenticated, HasAnyRole.required('nurse', 'supervisor', 'admin'),
                          HasAllScopes.required('patients:read', 'handover:write')]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not _enabled():
            self.permission_denied(request, message='TEST_ENV exception handover disabled.')

    @staticmethod
    def record(request, shift_id):
        record = ExceptionHandoverShift.objects.filter(id=shift_id).first()
        if record is None:
            return None, Response({'code': 'shift_not_found'}, status=404)
        error = _scope(request, record.unit_id)
        if error is not None:
            return None, error
        if record.expires_at <= timezone.now():
            return None, Response({'code': 'shift_expired'}, status=410)
        return record, None


class ExceptionShiftsView(ExceptionHandoverBase):
    def get(self, request):
        unit_id = str(request.query_params.get('unitId') or '').strip()
        if not unit_id:
            return Response({'code': 'unit_required'}, status=400)
        error = _scope(request, unit_id)
        if error is not None:
            return error
        shifts = ExceptionHandoverShift.objects.filter(unit_id=unit_id, expires_at__gt=timezone.now())
        return Response({'shifts': [_public(record) for record in shifts.order_by('-created_at')[:50]]})

    def post(self, request):
        body = request.data
        if not isinstance(body, dict):
            return Response({'code': 'shift_invalid'}, status=400)
        unit_id = str(body.get('unitId') or '').strip()
        if not unit_id:
            return Response({'code': 'unit_required'}, status=400)
        error = _scope(request, unit_id)
        if error is not None:
            return error
        start, end = parse_datetime(str(body.get('periodStart') or '')), parse_datetime(str(body.get('periodEnd') or ''))
        description = body.get('description')
        operation_id = _uuid(body.get('operationId'))
        if not start or not end or timezone.is_naive(start) or timezone.is_naive(end) or end <= start or \
                not isinstance(description, str) or not description.strip() or len(description.strip()) > 160 or not operation_id:
            return Response({'code': 'shift_invalid'}, status=400)
        actor = _actor(request)
        digest = _digest([unit_id, start.isoformat(), end.isoformat(), description.strip(), actor])
        prior = ExceptionHandoverShift.objects.filter(creation_key=operation_id).first()
        if prior:
            prior_error = _scope(request, prior.unit_id)
            if prior_error is not None:
                return prior_error
            return Response(_public(prior), status=200) if prior.creation_hash == digest else \
                Response({'code': 'operation_conflict'}, status=409)
        shift_id = uuid.uuid4()
        try:
            references = _prior_references(unit_id)
        except ClinicalBundleStorageError:
            return Response({'code': 'state_unavailable'}, status=503)
        state = {'version': 2, 'shiftId': str(shift_id), 'events': [], 'overrides': [],
                 'interactionCounts': {}, 'briefDrafts': {}, 'degradedTransfer': None,
                 'acceptedReferences': references, '_operations': {}}
        envelope, metadata = encrypt_bundle_document(state)
        record = ExceptionHandoverShift(id=shift_id, unit_id=unit_id, period_start=start,
            period_end=end, description=description.strip(), creator_sub=actor,
            creation_key=operation_id, creation_hash=digest, state_json=envelope,
            encryption_metadata=metadata,
            expires_at=timezone.now() + timedelta(days=min(settings.HANDOVER_BUNDLE_RETENTION_DAYS, 30)))
        try:
            with transaction.atomic():
                record.save(force_insert=True)
        except IntegrityError:
            prior = ExceptionHandoverShift.objects.get(creation_key=operation_id)
            prior_error = _scope(request, prior.unit_id)
            if prior_error is not None:
                return prior_error
            return Response(_public(prior), status=200) if prior.creation_hash == digest else \
                Response({'code': 'operation_conflict'}, status=409)
        return Response(_public(record), status=201)


class ExceptionShiftView(ExceptionHandoverBase):
    def get(self, request, shift_id):
        record, error = self.record(request, shift_id)
        if error is not None:
            return error
        try:
            return Response(_public(record, include_state=True))
        except ClinicalBundleStorageError:
            return Response({'code': 'state_unavailable'}, status=503)


class ExceptionShiftOperationView(ExceptionHandoverBase):
    def get(self, request, shift_id, operation_id):
        record, error = self.record(request, shift_id)
        if error is not None:
            return error
        try:
            receipt = _read(record).get('_operations', {}).get(str(operation_id))
        except ClinicalBundleStorageError:
            return Response({'code': 'state_unavailable'}, status=503)
        return Response(receipt) if receipt else Response({'code': 'operation_not_found'}, status=404)

    def post(self, request, shift_id, operation_id):
        record, error = self.record(request, shift_id)
        if error is not None:
            return error
        body = request.data
        proposed = body.get('state') if isinstance(body, dict) else None
        expected_revision = body.get('expectedRevision') if isinstance(body, dict) else None
        if not isinstance(proposed, dict) or not _receipt_domain(proposed) or \
                not isinstance(expected_revision, int) or _uuid(operation_id) is None:
            return Response({'code': 'operation_invalid'}, status=400)
        digest = _digest(proposed)
        for attempt in range(5):
            try:
                return self._commit_operation(request, record, proposed, expected_revision, digest, operation_id)
            except ClinicalBundleStorageError:
                return Response({'code': 'state_unavailable'}, status=503)
            except OperationalError as error:
                locked = connection.vendor == 'sqlite' and ('database is locked' in str(error).lower() or
                    'database table is locked' in str(error).lower())
                if not locked:
                    raise
                if attempt == 4:
                    return Response({'code': 'write_contended'}, status=503)
                time.sleep(0.02 * (attempt + 1) + random.uniform(0, 0.02))

    @staticmethod
    def _commit_operation(request, record, original, expected_revision, digest, operation_id):
        with transaction.atomic():
            locked = ExceptionHandoverShift.objects.select_for_update().get(id=record.id)
            previous = _read(locked)
            receipt = previous.get('_operations', {}).get(str(operation_id))
            if receipt:
                return Response(receipt) if receipt['contentHash'] == digest else \
                    Response({'code': 'operation_conflict'}, status=409)
            if locked.revision != expected_revision:
                return Response({'code': 'revision_conflict', 'revision': locked.revision}, status=409)
            proposed = json.loads(json.dumps(original))
            issue = _transition(previous, proposed, locked, _actor(request))
            if issue:
                return Response({'code': issue}, status=400)
            receipt = {'operationId': str(operation_id), 'contentHash': digest,
                       'revision': locked.revision + 1, 'status': 'confirmed'}
            proposed['_operations'] = {**previous.get('_operations', {}), str(operation_id): receipt}
            locked.state_json, locked.encryption_metadata = encrypt_bundle_document(proposed)
            locked.revision += 1
            updated = ExceptionHandoverShift.objects.filter(id=locked.id, revision=expected_revision).update(
                state_json=locked.state_json, encryption_metadata=locked.encryption_metadata,
                revision=locked.revision)
            if not updated:
                return Response({'code': 'revision_conflict', 'revision': expected_revision}, status=409)
            return Response(receipt, status=201)
