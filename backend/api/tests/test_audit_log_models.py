import hashlib
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from backend.api.models import ClientAuditEvent
from backend.audit.models import AuditEvent


def _expected_patient_key(patient_id: str) -> str:
    digest = hashlib.sha256(f"handover.audit.patient.v1:{patient_id}".encode("utf-8")).hexdigest()
    return f"ptk_{digest[:24]}"


class AuditEventModelIsolationTests(TestCase):
    def test_can_create_and_query_both_audit_event_models(self):
        client_event = ClientAuditEvent.objects.create(
            type="patient_open",
            user_id="user-1",
            patient_id="pat-1",
            occurred_at=timezone.datetime(2026, 1, 1, 10, 0, tzinfo=dt_timezone.utc),
        )
        security_event = AuditEvent.objects.create(
            event_type="security_check",
            action="read",
            status="success",
        )

        self.assertEqual(ClientAuditEvent.objects.count(), 1)
        self.assertEqual(AuditEvent.objects.count(), 1)
        self.assertEqual(client_event._meta.label, "api.ClientAuditEvent")
        self.assertEqual(security_event._meta.label, "audit.AuditEvent")


class AuditLogViewTests(TestCase):
    def setUp(self):
        from rest_framework.permissions import AllowAny
        from rest_framework.test import APIClient

        from backend.api.views import AuditLogView

        self.client = APIClient()
        self.url = reverse("audit-log")

        user = get_user_model().objects.create_user(username="audit-user", password="testpass")
        self.client.force_authenticate(user=user)

        self._perm_patcher = patch.object(AuditLogView, "permission_classes", [AllowAny])
        self._auth_patcher = patch.object(AuditLogView, "authentication_classes", [])
        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

    def test_post_and_get_audit_log_uses_client_audit_event_model(self):
        payload = {
            "type": "patient_open",
            "userId": "clinician-1",
            "patientId": "pat-42",
            "unitId": "icu",
            "shiftCode": "N",
            "meta": {"ui": "timeline"},
            "at": "2026-01-01T10:00:00Z",
        }

        create_response = self.client.post(self.url, data=payload, format="json")
        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(ClientAuditEvent.objects.count(), 1)

        list_response = self.client.get(self.url)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]["type"], "patient_open")
        self.assertEqual(list_response.data[0]["patientKey"], _expected_patient_key("pat-42"))
        self.assertNotIn("patientId", list_response.data[0])
        self.assertEqual(ClientAuditEvent.objects.get().patient_id, _expected_patient_key("pat-42"))

    def test_get_masks_historical_raw_patient_ids(self):
        ClientAuditEvent.objects.create(
            type="patient_open",
            user_id="clinician-legacy",
            patient_id="pat-legacy-7",
            occurred_at=timezone.datetime(2026, 1, 1, 10, 0, tzinfo=dt_timezone.utc),
        )

        list_response = self.client.get(self.url)

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data[0]["patientKey"], _expected_patient_key("pat-legacy-7"))
        self.assertNotIn("patientId", list_response.data[0])

    def test_post_accepts_handover_signed_and_returns_patient_key(self):
        payload = {
            "type": "handover_signed",
            "userId": "supervisor-1",
            "patientKey": _expected_patient_key("pat-88"),
            "at": "2026-01-01T10:00:00Z",
        }

        create_response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["type"], "handover_signed")
        self.assertEqual(create_response.data["patientKey"], _expected_patient_key("pat-88"))
