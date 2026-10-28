import os
import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from django.urls import reverse
from rest_framework.test import APIClient

from backend.api.models import ExceptionHandoverShift, Patient
from backend.security.auth import Auth0User


def client_for(sub, units=('icu-a',)):
    claims = {'sub': sub, 'roles': ['nurse'], 'unitIds': list(units),
              'permissions': ['patients:read', 'handover:write']}
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

    def test_transfer_and_attestation_are_linked_to_distinct_actors(self):
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


@override_settings(HANDOVER_DEPLOYMENT_MODE='test')
class ExceptionHandoverConcurrencyTests(TransactionTestCase):
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
