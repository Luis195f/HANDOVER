import os
import copy
import hashlib
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest.mock import patch

from django.db import OperationalError, close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from datetime import datetime, timedelta, timezone as datetime_timezone
from django.urls import reverse
from django.core.management import call_command
from rest_framework.test import APIClient

from backend.api.models import ExceptionHandoverShift, Patient
from backend.api.views_exception_handover import ExceptionShiftOperationView
from backend.security.auth import Auth0User


def client_for(sub, units=('icu-a',), scopes=('patients:read', 'handover:write')):
    claims = {'sub': sub, 'roles': ['nurse'], 'unitIds': list(units),
              'permissions': list(scopes)}
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=sub, claims=claims), token=claims)
    return client


@override_settings(HANDOVER_DEPLOYMENT_MODE='test')
class ExceptionHandoverRuntimeTests(TestCase):
    def setUp(self):
        self.flag = patch.dict(os.environ, {'HANDOVER_EXCEPTION_TEST_RUNTIME': 'true'})
        self.flag.start()
        self.addCleanup(self.flag.stop)
        self.alice = client_for('auth0|alice')
        self.bob = client_for('auth0|bob')
        self.outsider = client_for('auth0|outsider', ('icu-b',))
        Patient.objects.create(first_name='Caso', last_name='Sintético', identifier='p-1',
                               unit='icu-a', service='test', room='1')

    def create_shift(self, key='e58813bf-26bd-4e14-9492-e66ef9f9e81a'):
        return self.alice.post(reverse('exception-shifts'), {
            'unitId': 'icu-a', 'periodStart': '2026-10-28T08:00:00Z',
            'periodEnd': '2026-10-28T16:00:00Z', 'description': 'Turno sintético',
            'operationId': key,
        }, format='json')

    def test_receipt_hash_fixture_matches_backend_canonical_bytes(self):
        fixture = json.loads((Path(__file__).resolve().parents[3] / 'tests' / 'fixtures' /
            'c12-receipt-canonical.json').read_text(encoding='utf-8'))
        from backend.api.views_exception_handover import _digest
        canonical = json.dumps(fixture['content'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        self.assertEqual(canonical, fixture['canonical'])
        self.assertEqual(_digest(fixture['content']), fixture['sha256'])

    def test_every_endpoint_requires_both_scopes(self):
        shift_id = self.create_shift().data['id']
        operation_id = '97b06123-4cd6-471d-a574-354113ca08be'
        routes = [reverse('exception-shifts'), reverse('exception-shift', args=[shift_id]),
                  reverse('exception-shift-operation', args=[shift_id, operation_id])]
        for scopes in (('patients:read',), ('handover:write',), ()):
            client = client_for('auth0|alice', scopes=scopes)
            for route in routes:
                self.assertEqual(client.get(route, {'unitId': 'icu-a'}).status_code, 403)
        for route in routes:
            self.assertIn(self.alice.get(route, {'unitId': 'icu-a'}).status_code, (200, 404))
        no_read = client_for('auth0|alice', scopes=('handover:write',))
        no_write = client_for('auth0|alice', scopes=('patients:read',))
        operation = reverse('exception-shift-operation', args=[shift_id, operation_id])
        for client in (no_read, no_write):
            self.assertEqual(client.post(operation, {'state': {}, 'expectedRevision': 0}, format='json').status_code, 403)
            self.assertEqual(client.post(reverse('exception-shifts'), {
                'unitId': 'icu-a', 'periodStart': '2026-10-28T08:00:00Z',
                'periodEnd': '2026-10-28T16:00:00Z', 'description': 'Otro',
                'operationId': '53441ea6-127a-4f8d-814c-7fdbb1c276d0',
            }, format='json').status_code, 403)

    def test_r_transfer_requires_explicit_zoned_target_and_authenticated_receiver(self):
        shift_id = self.create_shift().data['id']
        state = self.bob.get(reverse('exception-shift', args=[shift_id])).data['state']
        event = {'kind': 'r_transferred', 'shiftId': shift_id, 'patientId': '1',
                 'idempotencyKey': 'r-1', 'actorId': 'auth0|bob', 'actorKind': 'incoming',
                 'actorName': 'forged', 'recordedAt': '2026-10-28T10:00:00Z',
                 'reason': 'Fuente no disponible', 'receiverId': 'auth0|bob'}
        for target in ('', 'not-a-date', '2026-10-28T16:00:00'):
            invalid = copy.deepcopy(state)
            invalid['events'].append({**event, 'targetAt': target})
            self.assertEqual(self.operation(self.bob, shift_id,
                '96bb6243-c02d-4d14-b913-f45ab128c2a1', invalid, 0).status_code, 400)
        invalid = copy.deepcopy(state)
        invalid['events'].append({**event, 'targetAt': '2026-10-28T16:00:00Z', 'receiverId': 'auth0|alice'})
        self.assertEqual(self.operation(self.bob, shift_id,
            '96bb6243-c02d-4d14-b913-f45ab128c2a1', invalid, 0).status_code, 400)
        valid = copy.deepcopy(state)
        valid['events'].append({**event, 'targetAt': '2026-10-28T16:00:00Z'})
        self.assertEqual(self.operation(self.bob, shift_id,
            '96bb6243-c02d-4d14-b913-f45ab128c2a1', valid, 0).status_code, 201)

    def test_sqlite_lock_retry_is_bounded_and_preserves_original_operation(self):
        shift_id = self.create_shift().data['id']
        state = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        state['interactionCounts']['reviewed'] = 1
        original = ExceptionShiftOperationView._commit_operation
        calls = []

        def transient(*args):
            calls.append(args[2])
            if len(calls) < 3:
                raise OperationalError('database table is locked: api_handoverbundlerecord')
            return original(*args)

        with patch.object(ExceptionShiftOperationView, '_commit_operation', side_effect=transient), \
                patch('backend.api.views_exception_handover.time.sleep'):
            result = self.operation(self.alice, shift_id,
                '6237c78d-3e73-4e63-9ca0-cb9b86ae2d73', state, 0)
        self.assertEqual(result.status_code, 201)
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 1)
        with patch.object(ExceptionShiftOperationView, '_commit_operation',
                side_effect=OperationalError('database is locked')), \
                patch('backend.api.views_exception_handover.time.sleep'):
            exhausted = self.operation(self.alice, shift_id,
                'd50d2c1d-4f3b-4766-956b-349733ca48e1', state, 1)
        self.assertEqual(exhausted.status_code, 503)
        self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 1)
        with patch.object(ExceptionShiftOperationView, '_commit_operation',
                side_effect=OperationalError('no such table')):
            with self.assertRaises(OperationalError):
                self.operation(self.alice, shift_id,
                    'b0ddf37e-4d05-4f20-91f5-1e79f723c4cd', state, 1)
        self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 1)

    def test_creation_is_idempotent_and_shared_but_scoped(self):
        first = self.create_shift()
        self.assertEqual(first.status_code, 201)
        shift_id = first.data['id']
        self.assertEqual(self.create_shift().data['id'], shift_id)
        self.assertEqual(self.bob.get(reverse('exception-shift', args=[shift_id])).status_code, 200)
        self.assertEqual(self.outsider.get(reverse('exception-shift', args=[shift_id])).status_code, 403)
        self.assertEqual(len(self.bob.get(reverse('exception-shifts'), {'unitId': 'icu-a'}).data['shifts']), 1)
        self.assertEqual(self.outsider.get(reverse('exception-shifts'), {'unitId': 'icu-a'}).status_code, 403)
        self.assertEqual(self.outsider.get(reverse('exception-shifts'), {'unitId': 'icu-b'}).data['shifts'], [])
        self.assertEqual(self.bob.get(reverse('exception-shift', args=['00000000-0000-4000-8000-000000000001'])).status_code, 404)

    def test_same_creation_key_with_different_content_conflicts(self):
        self.assertEqual(self.create_shift().status_code, 201)
        changed = self.alice.post(reverse('exception-shifts'), {
            'unitId': 'icu-a', 'periodStart': '2026-10-28T09:00:00Z',
            'periodEnd': '2026-10-28T16:00:00Z', 'description': 'Otro turno',
            'operationId': 'e58813bf-26bd-4e14-9492-e66ef9f9e81a',
        }, format='json')
        self.assertEqual(changed.status_code, 409)

    def test_gate_authentication_expiry_and_unit_scope_fail_closed(self):
        self.assertEqual(APIClient().get(reverse('exception-shifts'), {'unitId': 'icu-a'}).status_code, 401)
        with override_settings(HANDOVER_DEPLOYMENT_MODE='production'):
            self.assertEqual(self.alice.get(reverse('exception-shifts'), {'unitId': 'icu-a'}).status_code, 403)
        self.assertEqual(self.outsider.post(reverse('exception-shifts'), {
            'unitId': 'icu-a', 'periodStart': '2026-10-28T08:00:00Z',
            'periodEnd': '2026-10-28T16:00:00Z', 'description': 'Otro',
            'operationId': '59df0964-68a4-4abe-b2a7-f9d54ae02df5',
        }, format='json').status_code, 403)
        shift_id = self.create_shift().data['id']
        ExceptionHandoverShift.objects.filter(id=shift_id).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.bob.get(reverse('exception-shift', args=[shift_id])).status_code, 410)

    def operation(self, client, shift_id, operation_id, state, revision):
        return client.post(reverse('exception-shift-operation', args=[shift_id, operation_id]),
                           {'state': state, 'expectedRevision': revision}, format='json')

    def test_state_revision_replay_actor_and_patient_scope(self):
        shift_id = self.create_shift().data['id']
        state = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        fractional = copy.deepcopy(state)
        fractional['interactionCounts']['reviewed'] = 0.5
        self.assertEqual(self.operation(self.alice, shift_id,
                         '09f0aa62-68d1-4139-b9e5-9e70c589a630', fractional, 0).status_code, 400)
        event = {'kind': 'brief_review', 'shiftId': shift_id, 'patientId': '1',
                 'idempotencyKey': 'review-1', 'actorId': 'auth0|alice',
                 'actorKind': 'outgoing', 'actorName': 'forged',
                 'recordedAt': '2026-10-28T10:00:00Z'}
        state['events'].append(event)
        operation_id = '97b06123-4cd6-471d-a574-354113ca08be'
        first = self.operation(self.alice, shift_id, operation_id, state, 0)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.operation(self.alice, shift_id, operation_id, state, 0).data,
                         first.data)
        self.assertEqual(self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
                         ['events'][0]['actorName'], 'auth0|alice')
        changed = copy.deepcopy(state)
        changed['events'][0]['kind'] = 'critical_check_back'
        self.assertEqual(self.operation(self.alice, shift_id, operation_id, changed, 0).status_code, 409)
        self.assertEqual(self.operation(self.alice, shift_id,
                         '1e751ceb-354a-41e5-8688-6a2413a7b2c2', state, 0).status_code, 409)
        forged = copy.deepcopy(state)
        forged['events'][0]['actorId'] = 'auth0|bob'
        self.assertEqual(self.operation(self.bob, shift_id,
                         '0efdb5eb-e3f4-48d4-961e-81a8212eb70a', forged, 1).status_code, 400)
        foreign = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        foreign['events'].append({**event, 'idempotencyKey': 'foreign', 'patientId': '999'})
        self.assertEqual(self.operation(self.alice, shift_id,
                         '84ab719b-a248-438b-8783-a306728bf8e7', foreign, 1).status_code, 400)
        self.assertEqual(self.outsider.get(reverse('exception-shift-operation',
                         args=[shift_id, operation_id])).status_code, 403)
        foreign_draft = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        foreign_draft['briefDrafts']['999'] = {'change': 'synthetic'}
        self.assertEqual(self.operation(self.alice, shift_id,
                         'b8f9d627-d180-4fb8-bdec-a612183e4a15', foreign_draft, 1).status_code, 400)

    def test_inactive_patient_history_is_immutable_but_does_not_block_other_patients(self):
        second = Patient.objects.create(first_name='Segundo', last_name='Sintético', identifier='p-2',
                                        unit='icu-a', service='test', room='2')
        shift_id = self.create_shift().data['id']
        state = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        state['briefDrafts']['1'] = {'change': 'Registrado antes del alta'}
        state['events'].append({'kind': 'brief_review', 'shiftId': shift_id, 'patientId': '1',
            'idempotencyKey': 'before-discharge', 'actorId': 'auth0|alice', 'actorKind': 'outgoing',
            'recordedAt': '2026-10-28T10:00:00Z'})
        self.assertEqual(self.operation(self.alice, shift_id,
            '9156a31b-a353-4981-97c0-d740e953604a', state, 0).status_code, 201)
        Patient.objects.filter(id=1).update(active=False)
        current = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        current['briefDrafts'][str(second.id)] = {'change': 'Otro paciente autorizado'}
        self.assertEqual(self.operation(self.alice, shift_id,
            '751ea038-936a-4d6b-887a-330cc93e5a9e', current, 1).status_code, 201)
        saved = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        self.assertEqual(saved['events'][0]['idempotencyKey'], 'before-discharge')
        self.assertEqual(saved['briefDrafts']['1']['change'], 'Registrado antes del alta')
        altered = copy.deepcopy(saved)
        altered['briefDrafts']['1']['change'] = 'Cambio posterior no autorizado'
        self.assertEqual(self.operation(self.alice, shift_id,
            'a51ea038-936a-4d6b-887a-330cc93e5a9e', altered, 2).status_code, 400)
        removed = copy.deepcopy(saved)
        del removed['briefDrafts']['1']
        self.assertEqual(self.operation(self.alice, shift_id,
            'a61ea038-936a-4d6b-887a-330cc93e5a9e', removed, 2).status_code, 400)
        altered = copy.deepcopy(saved)
        altered['events'][0]['kind'] = 'critical_check_back'
        self.assertEqual(self.operation(self.alice, shift_id,
            'b51ea038-936a-4d6b-887a-330cc93e5a9e', altered, 2).status_code, 400)
        altered = copy.deepcopy(saved)
        altered['briefDrafts']['999'] = {'change': 'Paciente ajeno'}
        self.assertEqual(self.operation(self.alice, shift_id,
            'c51ea038-936a-4d6b-887a-330cc93e5a9e', altered, 2).status_code, 400)

    def test_prune_advances_revision_and_does_not_erase_confirmed_receipts(self):
        from backend.api.clinical_storage import encrypt_bundle_document
        shift_id = self.create_shift().data['id']
        record = ExceptionHandoverShift.objects.get(id=shift_id)
        state = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        state['acceptedReferences'] = [{'incomingKey': 'expired', 'expiresAt': '2026-10-27T00:00:00Z'}]
        record.state_json, record.encryption_metadata = encrypt_bundle_document(state)
        record.save(update_fields=['state_json', 'encryption_metadata'])
        call_command('prune_sensitive_records')
        record.refresh_from_db()
        self.assertEqual(record.revision, 1)
        current = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        self.assertEqual(current['acceptedReferences'], [])
        current['interactionCounts']['reviewed'] = 1
        operation_id = 'fd693e43-bbbf-4596-87f6-ae52ab692ed1'
        receipt = self.operation(self.alice, shift_id, operation_id, current, 1)
        self.assertEqual(receipt.status_code, 201)
        call_command('prune_sensitive_records')
        self.assertEqual(self.alice.get(reverse('exception-shift-operation',
            args=[shift_id, operation_id])).data, receipt.data)

    @patch('backend.api.views_exception_handover.timezone.now',
           return_value=datetime(2026, 10, 28, 11, tzinfo=datetime_timezone.utc))
    def test_transfer_and_attestation_are_linked_to_distinct_actors(self, _clock):
        shift_id = self.create_shift().data['id']
        context = {'key': 'context-1', 'shiftId': shift_id, 'revision': 1}
        snapshot = {'patientId': '1', 'unitId': 'icu-a', 'shiftId': shift_id,
                    'sources': {'care-plan': {'status': 'missing'}}}
        snapshots = [snapshot]
        manifest_hash = hashlib.sha256(json.dumps(snapshots, sort_keys=True,
            separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        manifest = {'context': context, 'snapshots': snapshots, 'hash': manifest_hash}
        outgoing = {'kind': 'outgoing_transfer', 'shiftId': shift_id, 'context': context,
                    'idempotencyKey': 'outgoing-1', 'actorId': 'auth0|alice',
                    'actorKind': 'outgoing', 'actorName': 'alice',
                    'recordedAt': '2026-10-28T10:00:00Z', 'manifestHash': manifest_hash}
        state = self.alice.get(reverse('exception-shift', args=[shift_id])).data['state']
        state['frozenManifest'] = manifest
        state['events'].append(outgoing)
        sent = self.operation(self.alice, shift_id, '894852e9-8958-45b3-bd57-d6040a552e71', state, 0)
        self.assertEqual(sent.status_code, 201)
        Patient.objects.filter(id=1).update(active=False)
        incoming = {'kind': 'incoming_attestation', 'shiftId': shift_id, 'context': context,
                    'idempotencyKey': 'incoming-1', 'actorId': 'auth0|bob',
                    'actorKind': 'incoming', 'actorName': 'bob',
                    'recordedAt': '2026-10-28T10:05:00Z', 'manifestHash': manifest_hash,
                    'acknowledgesKey': outgoing['idempotencyKey']}
        reference = {'version': 1, 'context': context, 'manifestHash': manifest_hash,
                     'outgoingKey': 'outgoing-1', 'incomingKey': 'incoming-1',
                     'acceptedBy': 'auth0|bob', 'acceptedAt': incoming['recordedAt'],
                     'expiresAt': '2026-10-29T10:05:00Z', 'snapshots': snapshots}
        received = self.bob.get(reverse('exception-shift', args=[shift_id])).data['state']
        received['events'].append(incoming)
        received['acceptedReferences'].append(reference)
        received.pop('frozenManifest')
        self.assertEqual(self.operation(self.alice, shift_id,
                         '6f69fd58-250f-43e4-9702-e9f9694e5480', received, 1).status_code, 400)
        accepted = self.operation(self.bob, shift_id,
                                  'fc54329e-9d5c-484a-a690-75695ef26685', received, 1)
        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(self.bob.get(reverse('exception-shift', args=[shift_id])).data['state']
                         ['acceptedReferences'][0]['acceptedBy'], 'auth0|bob')
        next_shift = self.alice.post(reverse('exception-shifts'), {
            'unitId': 'icu-a', 'periodStart': '2026-10-28T16:00:00Z',
            'periodEnd': '2026-10-29T00:00:00Z', 'description': 'Segundo turno',
            'operationId': '87c0fb33-88c0-4839-9efa-5aee63e72f2e',
        }, format='json')
        self.assertEqual(next_shift.status_code, 201)
        restored = self.bob.get(reverse('exception-shift', args=[next_shift.data['id']]))
        self.assertEqual(restored.data['state']['acceptedReferences'][0], reference)
        new_manifest = copy.deepcopy(self.bob.get(reverse('exception-shift', args=[shift_id])).data['state'])
        new_manifest['frozenManifest'] = manifest
        self.assertEqual(self.operation(self.bob, shift_id,
            '1403caac-a8ed-45a1-929e-724ee7ce5517', new_manifest, 2).status_code, 400)


@override_settings(HANDOVER_DEPLOYMENT_MODE='test')
class ExceptionHandoverConcurrencyTests(TransactionTestCase):
    def test_pruning_and_operation_preserve_each_other_in_both_orders(self):
        from backend.api.clinical_storage import encrypt_bundle_document
        from backend.api.management.commands import prune_sensitive_records
        from backend.api.views_exception_handover import _read

        with patch.dict(os.environ, {'HANDOVER_EXCEPTION_TEST_RUNTIME': 'true'}):
            for order in ('operation-first', 'prune-first'):
                created = client_for('auth0|alice').post(reverse('exception-shifts'), {
                    'unitId': 'icu-a', 'periodStart': '2026-10-28T08:00:00Z',
                    'periodEnd': '2026-10-28T16:00:00Z', 'description': order,
                    'operationId': 'ae0dbeba-75e7-4297-b230-5fb9cae6ed01' if order == 'operation-first'
                        else 'ae0dbeba-75e7-4297-b230-5fb9cae6ed02',
                }, format='json')
                self.assertEqual(created.status_code, 201)
                shift_id = created.data['id']
                record = ExceptionHandoverShift.objects.get(id=shift_id)
                state = _read(record)
                state['acceptedReferences'] = [{'incomingKey': 'expired',
                    'expiresAt': '2026-10-27T00:00:00Z'}]
                record.state_json, record.encryption_metadata = encrypt_bundle_document(state)
                record.save(update_fields=['state_json', 'encryption_metadata'])
                proposed = client_for('auth0|alice').get(reverse('exception-shift', args=[shift_id])).data['state']
                proposed['interactionCounts']['reviewed'] = 1
                operation_id = 'ae0dbeba-75e7-4297-b230-5fb9cae6ed11' if order == 'operation-first' \
                    else 'ae0dbeba-75e7-4297-b230-5fb9cae6ed12'
                if order == 'operation-first':
                    prune_read = Event()
                    operation_done = Event()
                    original_encrypt = prune_sensitive_records.encrypt_bundle_document

                    def pause_after_read(value):
                        if not prune_read.is_set():
                            prune_read.set()
                            if not operation_done.wait(5):
                                raise AssertionError('API operation did not finish before pruning')
                        return original_encrypt(value)

                    with patch.object(prune_sensitive_records, 'encrypt_bundle_document',
                                      side_effect=pause_after_read):
                        with ThreadPoolExecutor(max_workers=1) as pool:
                            future = pool.submit(prune_sensitive_records.prune_exception_references,
                                shift_id, timezone.now())
                            self.assertTrue(prune_read.wait(5))
                            receipt = client_for('auth0|alice').post(reverse('exception-shift-operation',
                                args=[shift_id, operation_id]),
                                {'state': proposed, 'expectedRevision': 0}, format='json')
                            self.assertEqual(receipt.status_code, 201)
                            operation_done.set()
                            self.assertEqual(future.result(timeout=5), 1)
                    self.assertEqual(client_for('auth0|alice').get(reverse('exception-shift-operation',
                        args=[shift_id, operation_id])).data, receipt.data)
                    self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 2)
                else:
                    api_read = Event()
                    prune_done = Event()

                    def submit_stale():
                        close_old_connections()
                        try:
                            api_read.set()
                            if not prune_done.wait(5):
                                raise AssertionError('Pruning did not finish before API write')
                            return client_for('auth0|alice').post(reverse('exception-shift-operation',
                                args=[shift_id, operation_id]),
                                {'state': proposed, 'expectedRevision': 0}, format='json')
                        finally:
                            close_old_connections()

                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(submit_stale)
                        self.assertTrue(api_read.wait(5))
                        self.assertEqual(prune_sensitive_records.prune_exception_references(
                            shift_id, timezone.now()), 1)
                        prune_done.set()
                        self.assertEqual(future.result(timeout=5).status_code, 409)
                    self.assertEqual(client_for('auth0|alice').post(reverse('exception-shift-operation',
                        args=[shift_id, operation_id]),
                        {'state': proposed, 'expectedRevision': 1}, format='json').status_code, 400)
                    self.assertEqual(client_for('auth0|alice').get(reverse('exception-shift-operation',
                        args=[shift_id, operation_id])).status_code, 404)
                    self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 1)
                final = _read(ExceptionHandoverShift.objects.get(id=shift_id))
                self.assertEqual(final['acceptedReferences'], [])
                if order == 'operation-first':
                    self.assertEqual(final['interactionCounts']['reviewed'], 1)

    def test_two_writers_cannot_confirm_the_same_revision(self):
        with patch.dict(os.environ, {'HANDOVER_EXCEPTION_TEST_RUNTIME': 'true'}):
            created = client_for('auth0|alice').post(reverse('exception-shifts'), {
                'unitId': 'icu-a', 'periodStart': '2026-10-28T08:00:00Z',
                'periodEnd': '2026-10-28T16:00:00Z', 'description': 'Concurrencia',
                'operationId': 'e7391b9d-4258-4f16-aac9-99c13740f13b',
            }, format='json')
            self.assertEqual(created.status_code, 201)
            shift_id = created.data['id']
            barrier = Barrier(2, timeout=5)

            def submit(index):
                close_old_connections()
                try:
                    client = client_for('auth0|alice')
                    state = client.get(reverse('exception-shift', args=[shift_id])).data['state']
                    state['interactionCounts'][f'writer-{index}'] = 1
                    barrier.wait()
                    return client.post(reverse('exception-shift-operation', args=[shift_id,
                        f'bb8849c1-37db-4eee-a0f0-040c7a66929{index}']),
                        {'state': state, 'expectedRevision': 0}, format='json').status_code
                finally:
                    close_old_connections()

            with ThreadPoolExecutor(max_workers=2) as pool:
                statuses = list(pool.map(submit, (0, 1)))
            self.assertEqual(statuses.count(201), 1)
            self.assertTrue(all(status in (201, 409, 503) for status in statuses))
            self.assertEqual(ExceptionHandoverShift.objects.get(id=shift_id).revision, 1)
