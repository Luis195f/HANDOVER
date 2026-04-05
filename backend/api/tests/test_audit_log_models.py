from datetime import timezone as dt_timezone
import types
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from backend.api.audit_pseudonymization import build_audit_patient_key, sanitize_client_audit_meta
from backend.api.models import ClientAuditEvent
from backend.audit.models import AuditEvent


def _expected_patient_key(patient_id: str) -> str:
    return build_audit_patient_key(patient_id)


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

        user = types.SimpleNamespace(
            is_authenticated=True,
            sub="audit-user",
            username="audit-user",
            claims={"sub": "audit-user"},
        )
        self.client.force_authenticate(user=user, token=user.claims)

        self._perm_patcher = patch.object(AuditLogView, "permission_classes", [AllowAny])
        self._auth_patcher = patch.object(AuditLogView, "authentication_classes", [])
        self._perm_patcher.start()
        self._auth_patcher.start()
        self.addCleanup(self._perm_patcher.stop)
        self.addCleanup(self._auth_patcher.stop)

    def test_post_and_get_audit_log_uses_client_audit_event_model(self):
        payload = {
            "type": "patient_open",
            "userId": "audit-user",
            "patientKey": build_audit_patient_key("pat-42"),
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

    def test_post_accepts_legacy_transport_key_but_persists_canonical_ptk2(self):
        payload = {
            "type": "patient_open",
            "userId": "audit-user",
            "patientKey": "ptk_abc123abc123abc123abc123",
            "at": "2026-01-01T10:00:00Z",
        }

        response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(response.status_code, 201)
        persisted = ClientAuditEvent.objects.get()
        self.assertTrue(persisted.patient_id.startswith("ptk2_"))
        self.assertNotEqual(persisted.patient_id, payload["patientKey"])
        self.assertEqual(response.data["patientKey"], persisted.patient_id)

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
            "userId": "audit-user",
            "patientKey": _expected_patient_key("pat-88"),
            "at": "2026-01-01T10:00:00Z",
        }

        create_response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.data["type"], "handover_signed")
        self.assertEqual(create_response.data["patientKey"], _expected_patient_key("pat-88"))

    def test_patient_key_is_deterministic_for_raw_ids_and_patient_references(self):
        direct = build_audit_patient_key("pat-42")
        reference = build_audit_patient_key("Patient/pat-42")
        self.assertEqual(direct, reference)
        self.assertEqual(direct, _expected_patient_key("pat-42"))

    def test_post_rejects_payloads_with_raw_patient_identifier_fields(self):
        payload = {
            "type": "patient_edit",
            "userId": "audit-user",
            "patientKey": build_audit_patient_key("pat-77"),
            "meta": {
                "ui": "timeline",
                "patientId": "pat-77",
                "nested": {"patient_reference": "Patient/pat-77"},
            },
        }

        response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ClientAuditEvent.objects.count(), 0)

    def test_post_rejects_raw_patient_id_top_level_field(self):
        payload = {
            "type": "patient_edit",
            "userId": "audit-user",
            "patientId": "pat-77",
        }

        response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ClientAuditEvent.objects.count(), 0)

    def test_post_rejects_extra_top_level_fields_like_client_local_id(self):
        payload = {
            "type": "patient_edit",
            "userId": "audit-user",
            "patientKey": build_audit_patient_key("pat-77"),
            "id": "9d17d2da-9f48-4ca5-8742-8b7047cc936b",
        }

        response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ClientAuditEvent.objects.count(), 0)

    def test_get_does_not_expose_legacy_raw_patient_ids_from_meta(self):
        ClientAuditEvent.objects.create(
            type="patient_open",
            user_id="clinician-legacy",
            patient_id="pat-legacy-11",
            meta={"patientId": "pat-legacy-11", "context": {"patientId": "pat-legacy-context"}},
            occurred_at=timezone.datetime(2026, 1, 1, 10, 0, tzinfo=dt_timezone.utc),
        )

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["patientKey"], _expected_patient_key("pat-legacy-11"))
        self.assertNotIn("patientId", str(response.data[0]))
        self.assertNotIn("pat-legacy-context", str(response.data[0]))

    def test_post_rejects_actor_mismatch_against_authenticated_user(self):
        payload = {
            "type": "handover_signed",
            "userId": "spoofed-user",
            "patientKey": _expected_patient_key("pat-88"),
            "at": "2026-01-01T10:00:00Z",
        }

        response = self.client.post(self.url, data=payload, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["errors"], ["Authenticated audit actor mismatch."])
        self.assertEqual(ClientAuditEvent.objects.count(), 0)


class AuditMetaSanitizationTests(TestCase):
    def test_sanitize_client_audit_meta_returns_none_for_invalid_root(self):
        self.assertIsNone(sanitize_client_audit_meta("not-a-dict"))
