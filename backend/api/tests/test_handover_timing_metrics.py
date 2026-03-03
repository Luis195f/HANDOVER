from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient, APIRequestFactory

from backend.audit.models import AuditEvent
from backend.api.views import HandoverTimingMetricsView
from backend.security.permissions import IsAdminOrSupervisor


class HandoverTimingMetricsViewTests(TestCase):
    def setUp(self):
        from rest_framework.permissions import AllowAny

        self.client = APIClient()
        self.url = reverse('handover-time-metrics')
        user = get_user_model().objects.create_user(username='metric-user', password='testpass')
        self.client.force_authenticate(user=user)

        self._perm_patcher = patch.object(HandoverTimingMetricsView, 'get_permissions', return_value=[AllowAny()])
        self._auth_patcher = patch.object(HandoverTimingMetricsView, 'authentication_classes', [])
        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

    @patch('backend.api.views._get_authenticated_user_sub', return_value='auth0|metrics')
    def test_post_creates_audit_event_with_duration(self, _mock_sub):
        payload = {
            'sectionId': 'sbar',
            'durationMs': 1450,
            'unitId': 'icu-a',
            'requestId': 'tx-001',
        }

        response = self.client.post(self.url, data=payload, format='json')

        self.assertEqual(response.status_code, 201)
        event = AuditEvent.objects.get(event_type='handover_timing')
        self.assertEqual(event.meta['timing']['sectionId'], 'sbar')
        self.assertEqual(event.meta['timing']['durationMs'], 1450)
        self.assertEqual(event.meta['timing']['unitId'], 'icu-a')

    def test_post_rejects_forbidden_or_unknown_fields(self):
        payload = {
            'sectionId': 'sbar',
            'durationMs': 200,
            'unitId': 'icu-a',
            'requestId': 'tx-1',
            'sbar': 'contenido clinico no permitido',
        }

        response = self.client.post(self.url, data=payload, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditEvent.objects.filter(event_type='handover_timing').count(), 0)

    def test_get_returns_aggregated_metrics(self):
        AuditEvent.objects.create(
            event_type='handover_timing',
            action='create',
            status='success',
            meta={'timing': {'sectionId': 'vitals', 'durationMs': 1000, 'unitId': 'icu-a'}},
        )
        AuditEvent.objects.create(
            event_type='handover_timing',
            action='create',
            status='success',
            meta={'timing': {'sectionId': 'vitals', 'durationMs': 2000, 'unitId': 'icu-a'}},
        )

        response = self.client.get(self.url, {'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['sectionId'], 'vitals')
        self.assertEqual(response.data['results'][0]['avgDurationMs'], 1500)
        self.assertEqual(response.data['results'][0]['samples'], 2)



    def test_get_includes_all_events_without_silent_truncation(self):
        bulk_events = [
            AuditEvent(
                event_type='handover_timing',
                action='create',
                status='success',
                meta={'timing': {'sectionId': 'sbar', 'durationMs': 1000, 'unitId': 'icu-a'}},
            )
            for _ in range(5001)
        ]
        AuditEvent.objects.bulk_create(bulk_events)

        response = self.client.get(self.url, {'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['sectionId'], 'sbar')
        self.assertEqual(response.data['results'][0]['avgDurationMs'], 1000)
        self.assertEqual(response.data['results'][0]['samples'], 5001)

    def test_get_aggregates_by_section_and_unit(self):
        AuditEvent.objects.create(
            event_type='handover_timing',
            action='create',
            status='success',
            meta={'timing': {'sectionId': 'sbar', 'durationMs': 500, 'unitId': 'icu-a'}},
        )
        AuditEvent.objects.create(
            event_type='handover_timing',
            action='create',
            status='success',
            meta={'timing': {'sectionId': 'vitals', 'durationMs': 2000, 'unitId': 'icu-a'}},
        )
        AuditEvent.objects.create(
            event_type='handover_timing',
            action='create',
            status='success',
            meta={'timing': {'sectionId': 'vitals', 'durationMs': 1000, 'unitId': 'icu-a'}},
        )

        response = self.client.get(self.url, {'unitId': 'icu-a'})

        self.assertEqual(response.status_code, 200)
        result_by_section = {row['sectionId']: row for row in response.data['results']}
        self.assertEqual(result_by_section['sbar']['samples'], 1)
        self.assertEqual(result_by_section['sbar']['avgDurationMs'], 500)
        self.assertEqual(result_by_section['vitals']['samples'], 2)
        self.assertEqual(result_by_section['vitals']['avgDurationMs'], 1500)


class HandoverTimingMetricsPermissionsTests(TestCase):
    def test_get_permissions_enforces_supervisor_or_admin(self):
        factory = APIRequestFactory()
        request = factory.get('/api/metrics/handover-time')
        view = HandoverTimingMetricsView()
        view.request = view.initialize_request(request)

        permissions = view.get_permissions()

        self.assertTrue(any(isinstance(permission, IsAdminOrSupervisor) for permission in permissions))
