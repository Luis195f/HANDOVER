import os
from copy import deepcopy
from importlib import import_module
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory

from backend.api.models import ClientAuditEvent, IceaBridgeRequest
from backend.api.views import AuthenticatedAPIView
from backend.security.auth import Auth0User


def authenticated_client(*, role='nurse', units=None, scopes=None):
    claims = {
        'sub': 'auth0|scope-test',
        'roles': [role],
        'unitIds': units or [],
        'permissions': scopes or [],
    }
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=claims['sub'], claims=claims), token=claims)
    client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-token')
    return client


def patient_resource(unit):
    return {
        'resourceType': 'Patient',
        'id': 'pat-1',
        'extension': [{'url': 'https://handover.dev/fhir/StructureDefinition/unit-id', 'valueString': unit}],
    }


class PatientScopeGapTests(TestCase):
    def setUp(self):
        self.client = authenticated_client(role='viewer', units=['icu-a'], scopes=['patients:read'])
        self.url = reverse('patient')

    def test_patient_id_traversal_is_rejected_before_upstream_lookup(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient_resource('icu-a')
        with patch('backend.api.views.httpx.get', return_value=upstream_response) as upstream:
            for patient_id in ('.', '../Observation/secret', '%2e%2e%2fObservation', r'..\Observation'):
                response = self.client.get(self.url, {'id': patient_id})
                self.assertEqual(response.status_code, 400)
        upstream.assert_not_called()

    def test_unexpected_resource_type_is_not_returned_as_patient(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = {'resourceType': 'Observation', 'id': 'foreign'}
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('foreign', str(response.data))

    def test_non_traversal_dotted_patient_id_remains_supported(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient_resource('icu-a')
        with patch('backend.api.views.httpx.get', return_value=upstream_response) as upstream:
            response = self.client.get(self.url, {'id': 'pat..1'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(upstream.call_args.args[0].endswith('/Patient/pat..1'))

    def test_reference_display_is_not_a_second_unit_identifier(self):
        patient = patient_resource('icu-a')
        patient['managingOrganization'] = {
            'reference': 'Organization/icu-a', 'display': 'Intensive Care Unit',
        }
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            direct = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(direct.status_code, 200)

        upstream_response.json.return_value = {
            'resourceType': 'Bundle', 'type': 'searchset', 'entry': [{'resource': patient}],
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            search = self.client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(search.data['total'], 1)

        nurse = authenticated_client(units=['icu-a'], scopes=['patients:write'])
        with patch('backend.api.views._validate_remotely', return_value=None), patch(
            'backend.api.views._post_to_fhir', return_value=Response({'resourceType': 'Patient'}, status=201)
        ):
            write = nurse.post(self.url, patient, format='json')
        self.assertEqual(write.status_code, 201)

    def test_managing_organization_identifier_uses_only_unit_id_system(self):
        patient = patient_resource('icu-a')
        patient['managingOrganization'] = {
            'reference': 'Organization/icu-a',
            'identifier': {'system': 'https://hospital.example/mrn', 'value': '12345'},
        }
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        original = deepcopy(patient)
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(patient, original)

        upstream_response.json.return_value = {
            'resourceType': 'Bundle', 'type': 'searchset', 'entry': [{'resource': patient}],
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            search = self.client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(search.data['total'], 1)

        writer = authenticated_client(units=['icu-a'], scopes=['patients:write'])
        with patch('backend.api.views._validate_remotely', return_value=None), patch(
            'backend.api.views._post_to_fhir', return_value=Response({'resourceType': 'Patient'}, status=201)
        ) as upstream:
            write = writer.post(self.url, patient, format='json')
        self.assertEqual(write.status_code, 201)
        upstream.assert_called_once()
        self.assertEqual(patient, original)

        patient['managingOrganization'] = {
            'identifier': {'system': 'urn:handover:unit-id', 'value': 'icu-a'},
        }
        upstream_response.json.return_value = patient
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            canonical = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(canonical.status_code, 200)

        patient['managingOrganization']['identifier']['system'] = 'https://hospital.example/mrn'
        patient.pop('extension')
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            unrelated_only = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(unrelated_only.status_code, 403)

    def test_versioned_organization_reference_keeps_its_unit_identity(self):
        patient = patient_resource('icu-a')
        patient['managingOrganization'] = {'reference': 'Organization/icu-a/_history/2'}
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(response.status_code, 200)

    def test_contained_reference_is_not_inferred_as_unit_id(self):
        patient = {
            'resourceType': 'Patient', 'id': 'pat-1',
            'managingOrganization': {'reference': '#icu-a'},
        }
        original = deepcopy(patient)
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        with patch('backend.api.views.httpx.get', return_value=upstream_response) as upstream:
            direct = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(direct.status_code, 403)
        upstream.assert_called_once()

        upstream_response.json.return_value = {
            'resourceType': 'Bundle', 'type': 'searchset', 'entry': [{'resource': patient}],
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            search = self.client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(search.data['total'], 0)
        self.assertEqual(patient, original)

    def test_multiunit_token_does_not_authorize_contradictory_patient_evidence(self):
        patient = patient_resource('icu-a')
        patient['managingOrganization'] = {'reference': 'Organization/icu-b'}
        original = deepcopy(patient)
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        client = authenticated_client(role='supervisor', units=['icu-a', 'icu-b'], scopes=['patients:read'])
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            direct = client.get(self.url, {'id': 'pat-1', 'unit': 'icu-a'})
        self.assertEqual(direct.status_code, 403)

        upstream_response.json.return_value = {
            'resourceType': 'Bundle', 'type': 'searchset', 'entry': [{'resource': patient}],
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            search = client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(search.data['total'], 0)

        writer = authenticated_client(role='supervisor', units=['icu-a', 'icu-b'], scopes=['patients:write'])
        with patch('backend.api.views._validate_remotely', return_value=None), patch(
            'backend.api.views._post_to_fhir'
        ) as upstream:
            write = writer.post(self.url, patient, format='json')
        self.assertEqual(write.status_code, 403)
        upstream.assert_not_called()
        self.assertEqual(patient, original)

    def test_conflicting_authoritative_patient_units_still_fail_closed(self):
        patient = patient_resource('icu-a')
        patient['managingOrganization'] = {
            'reference': 'Organization/icu-b', 'display': 'Intensive Care Unit',
        }
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = patient
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(response.status_code, 403)

    def test_display_only_does_not_authorize_patient_access(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = {
            'resourceType': 'Patient', 'id': 'pat-1',
            'managingOrganization': {'display': 'icu-a'},
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'id': 'pat-1'})
        self.assertEqual(response.status_code, 403)

    def test_search_never_returns_non_patient_entries_or_foreign_units(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = {
            'resourceType': 'Bundle', 'type': 'searchset',
            'entry': [
                {'resource': patient_resource('icu-a')},
                {'resource': patient_resource('icu-b')},
                {'resource': {'resourceType': 'Observation', 'id': 'foreign', 'unit': 'icu-a'}},
            ],
        }
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total'], 1)
        self.assertEqual(response.data['entry'][0]['resource']['resourceType'], 'Patient')

    def test_patient_write_requires_unit_evidence_inside_authenticated_scope(self):
        client = authenticated_client(units=['icu-a'], scopes=['patients:write'])
        with patch('backend.api.views._validate_remotely', return_value=None), patch('backend.api.views._post_to_fhir') as upstream:
            foreign = client.post(self.url, patient_resource('icu-b'), format='json')
            contradictory = patient_resource('icu-a')
            contradictory['extension'].append({
                'url': 'https://handover.dev/fhir/StructureDefinition/unit-id', 'valueString': 'icu-b',
            })
            mixed = client.post(self.url, contradictory, format='json')
            missing = client.post(self.url, {'resourceType': 'Patient', 'id': 'pat-1'}, format='json')
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(mixed.status_code, 403)
        self.assertEqual(missing.status_code, 403)
        upstream.assert_not_called()

    def test_patient_write_preserves_authorized_unit_and_admin_exception(self):
        nurse = authenticated_client(units=['icu-a'], scopes=['patients:write'])
        admin = authenticated_client(role='admin', scopes=['patients:write'])
        with patch('backend.api.views._validate_remotely', return_value=None), patch(
            'backend.api.views._post_to_fhir', return_value=Response({'resourceType': 'Patient'}, status=201)
        ) as upstream:
            nurse_response = nurse.post(self.url, patient_resource('icu-a'), format='json')
            admin_response = admin.post(self.url, patient_resource('icu-b'), format='json')
        self.assertEqual(nurse_response.status_code, 201)
        self.assertEqual(admin_response.status_code, 201)
        self.assertEqual(upstream.call_count, 2)

    def test_search_rejects_unexpected_upstream_resource_type(self):
        upstream_response = Mock(status_code=200)
        upstream_response.json.return_value = {'resourceType': 'Observation', 'id': 'foreign'}
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            response = self.client.get(self.url, {'unit': 'icu-a'})
        self.assertEqual(response.status_code, 502)
        with patch('backend.api.views.httpx.get', return_value=upstream_response):
            local_registry_response = self.client.get(reverse('patients'), {'unit': 'icu-a'})
        self.assertEqual(local_registry_response.status_code, 502)


class BridgeScopeGapTests(TestCase):
    def setUp(self):
        self.first = self._bridge('a', 'icu-a')
        self.second = self._bridge('b', 'icu-b')
        self.detail_url = reverse('icea-bridge-status-detail', kwargs={'handover_id': 'bundle-b'})
        self.summary_url = reverse('icea-bridge-summary', kwargs={'handover_id': 'bundle-b'})
        self.query_url = reverse('icea-bridge-status-query')

    @staticmethod
    def _bridge(suffix, unit):
        return IceaBridgeRequest.objects.create(
            bridge_request_id=f'bridge-{suffix}', request_id=f'request-{suffix}',
            bundle_id=f'bundle-{suffix}', patient_id=f'patient-{suffix}', unit_id=unit,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key=f'key-{suffix}', payload_hash=suffix * 64,
            payload_json={'contractVersion': 'handover-icea-bridge-v1'},
            status=IceaBridgeRequest.STATUS_PENDING,
        )

    def test_foreign_handover_id_never_materializes_or_refreshes(self):
        client = authenticated_client(units=['icu-a'])
        with patch('backend.api.views_icea_bridge.materialize_icea_bridge_requests_if_due') as materialize, patch(
            'backend.api.views_icea_bridge.refresh_icea_bridge_request'
        ) as refresh:
            for url in (self.detail_url, self.summary_url):
                foreign_id = client.get(url, {'refresh': 'true'})
                self.assertEqual(foreign_id.status_code, 404)
                response = client.get(url, {'refresh': 'true', 'unitId': 'icu-b'})
                self.assertIn(response.status_code, (403, 404))
                self.assertNotIn('patient-b', str(response.data))
        materialize.assert_not_called()
        refresh.assert_not_called()

    def test_query_filters_before_materialization_and_count(self):
        client = authenticated_client(role='supervisor', units=['icu-a'])
        seen_units = []

        def capture(queryset):
            seen_units.extend(queryset.values_list('unit_id', flat=True))

        with patch('backend.api.views_icea_bridge.materialize_icea_bridge_requests_if_due', side_effect=capture):
            response = client.get(self.query_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual({item['unitId'] for item in response.data['results']}, {'icu-a'})
        self.assertEqual(seen_units, ['icu-a'])

    def test_explicit_foreign_unit_rejected_before_materialization(self):
        client = authenticated_client(role='supervisor', units=['icu-a'])
        with patch('backend.api.views_icea_bridge.materialize_icea_bridge_requests_if_due') as materialize:
            response = client.get(self.query_url, {'unitId': 'icu-b'})
        self.assertEqual(response.status_code, 403)
        materialize.assert_not_called()

    def test_missing_claim_units_fail_closed_before_materialization(self):
        client = authenticated_client(role='supervisor')
        with patch('backend.api.views_icea_bridge.materialize_icea_bridge_requests_if_due') as materialize:
            response = client.get(self.query_url)
        self.assertEqual(response.status_code, 403)
        materialize.assert_not_called()

    def test_multiunit_and_admin_keep_only_their_existing_scope(self):
        with patch('backend.api.views_icea_bridge.materialize_icea_bridge_requests_if_due'):
            multi = authenticated_client(role='supervisor', units=['icu-a', 'icu-b']).get(self.query_url)
            admin = authenticated_client(role='admin').get(self.query_url)
        self.assertEqual(multi.status_code, 200)
        self.assertEqual(admin.status_code, 200)
        self.assertEqual(multi.data['count'], 2)
        self.assertEqual(admin.data['count'], 2)


class AuditAndPilotScopeGapTests(TestCase):
    def test_audit_reads_only_claim_units_and_rejects_foreign_write(self):
        ClientAuditEvent.objects.create(type='patient_open', user_id='auth0|scope-test', unit_id='icu-a', occurred_at=timezone.now())
        ClientAuditEvent.objects.create(type='patient_open', user_id='other', unit_id='icu-b', occurred_at=timezone.now())
        client = authenticated_client(units=['icu-a'], scopes=['audit:read', 'audit:write'])
        url = reverse('audit-log')
        response = client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([event['unitId'] for event in response.data], ['icu-a'])
        denied = client.post(url, {'type': 'patient_open', 'userId': 'auth0|scope-test', 'unitId': 'icu-b'}, format='json')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(ClientAuditEvent.objects.count(), 2)
        foreign_read = client.get(url, {'unitId': 'icu-b'})
        self.assertEqual(foreign_read.status_code, 403)
        multiunit = authenticated_client(role='supervisor', units=['icu-a', 'icu-b'], scopes=['audit:read']).get(url)
        self.assertEqual({event['unitId'] for event in multiunit.data}, {'icu-a', 'icu-b'})
        admin = authenticated_client(role='admin', scopes=['audit:read']).get(url)
        self.assertEqual(len(admin.data), 2)

    def test_pilot_context_rejects_foreign_unit_and_query_role_escalation(self):
        supervisor = authenticated_client(role='supervisor', units=['icu-a'])
        summary_url = reverse('pilot-control-summary')
        features_url = reverse('pilot-control-features')
        for mode in ('pilot', 'production'):
            with override_settings(HANDOVER_DEPLOYMENT_MODE=mode):
                for url in (summary_url, features_url):
                    denied = supervisor.get(url, {'unitId': 'icu-b', 'role': 'admin', 'roles': 'admin'})
                    self.assertEqual(denied.status_code, 403)
                allowed = supervisor.get(summary_url, {'unitId': 'icu-a', 'role': 'admin'})
                self.assertEqual(allowed.status_code, 200)
                self.assertEqual(allowed.data['requestedContext']['roles'], ['supervisor'])
        admin = authenticated_client(role='admin').get(features_url, {'unitId': 'icu-b'})
        self.assertEqual(admin.status_code, 200)


class PatientRiskScopeGapTests(TestCase):
    def setUp(self):
        BridgeScopeGapTests._bridge('risk-a', 'icu-a')
        BridgeScopeGapTests._bridge('risk-b', 'icu-b')
        self.url = reverse('icea-patient-risk')

    @patch.dict(os.environ, {'ENABLE_ICEA_BRIDGE': 'true', 'ENABLE_ICEA_PATIENT_RISK': 'true'})
    def test_supervisor_cannot_query_foreign_or_global_patient_risk(self):
        supervisor = authenticated_client(role='supervisor', units=['icu-a'])
        denied = supervisor.get(self.url, {'unitId': 'icu-b'})
        self.assertEqual(denied.status_code, 403)
        scoped = supervisor.get(self.url)
        self.assertEqual(scoped.status_code, 200)
        self.assertEqual(scoped.data['count'], 1)
        multi = authenticated_client(role='supervisor', units=['icu-a', 'icu-b']).get(self.url)
        self.assertEqual(multi.status_code, 400)
        no_units = authenticated_client(role='supervisor').get(self.url)
        self.assertEqual(no_units.status_code, 403)
        admin = authenticated_client(role='admin').get(self.url)
        self.assertEqual(admin.status_code, 200)


class EffectivePermissionGapTests(TestCase):
    @override_settings(HANDOVER_DEPLOYMENT_MODE='development', HANDOVER_LOCAL_AUTH_BYPASS_ALLOWED=True, AUTH0_CONFIGURED=False)
    def test_anonymous_medication_statement_cannot_reach_fhir_in_local_mode(self):
        with patch.object(AuthenticatedAPIView, '_running_tests', return_value=False), patch(
            'backend.api.views._post_to_fhir'
        ) as upstream:
            response = APIClient().post(reverse('medicationstatement'), {'resourceType': 'MedicationStatement'}, format='json')
        self.assertEqual(response.status_code, 403)
        upstream.assert_not_called()

    def test_all_authenticated_api_subclasses_keep_effective_permissions_in_local_modes(self):
        for module in (
            'backend.api.views', 'backend.api.views_ai', 'backend.api.views_clinical_decisions',
            'backend.api.views_icea', 'backend.api.views_icea_bridge',
            'backend.api.views_icea_ops', 'backend.api.views_pilot_control',
        ):
            import_module(module)

        def subclasses(base):
            for subclass in base.__subclasses__():
                yield subclass
                yield from subclasses(subclass)

        demo_public_allowlist = frozenset()
        factory = APIRequestFactory()
        for mode in ('development', 'demo'):
            with override_settings(HANDOVER_DEPLOYMENT_MODE=mode, HANDOVER_LOCAL_AUTH_BYPASS_ALLOWED=True, AUTH0_CONFIGURED=False), patch.object(
                AuthenticatedAPIView, '_running_tests', return_value=False
            ):
                for view_class in subclasses(AuthenticatedAPIView):
                    view = view_class()
                    view.request = factory.get('/api/protected')
                    permissions = view.get_permissions()
                    if view_class.__name__ not in demo_public_allowlist:
                        self.assertFalse(any(isinstance(permission, AllowAny) for permission in permissions), f'{mode}: {view_class.__name__}')
