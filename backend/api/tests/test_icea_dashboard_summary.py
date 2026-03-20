import types

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from backend.api.models import (
    HandoverBundleRecord,
    IceaBridgeRequest,
    IceaOutboundEvent,
    IceaPipelineEvent,
    IceaPipelineSnapshot,
)
from backend.audit.models import AuditEvent
from backend.api.tests.icea_test_utils import build_icea_bundle


def build_dashboard_clinical_bundle() -> dict:
    bundle = build_icea_bundle(
        bundle_id="bundle-dashboard-1",
        patient_id="pat-dashboard-1",
        unit_id="icu-a",
    )
    patient = bundle["entry"][0]["resource"]
    patient["name"] = [{"text": "Paciente Dashboard"}]
    encounter_reference = bundle["entry"][1]["fullUrl"]

    bundle["entry"].extend(
        [
            {
                "resource": {
                    "resourceType": "Observation",
                    "status": "final",
                    "code": {
                        "coding": [
                            {
                                "system": "urn:handover-pro:observation-codes",
                                "code": "administrative",
                            }
                        ]
                    },
                    "valueString": "Unit: icu-a\nIncidents: desaturación súbita",
                }
            },
            {
                "resource": {
                    "resourceType": "Observation",
                    "status": "final",
                    "code": {"coding": [{"system": "http://loinc.org", "code": "9279-1"}]},
                    "valueQuantity": {"value": 28},
                }
            },
            {
                "resource": {
                    "resourceType": "Observation",
                    "status": "final",
                    "code": {"coding": [{"system": "http://loinc.org", "code": "59408-5"}]},
                    "valueQuantity": {"value": 88},
                }
            },
            {
                "resource": {
                    "resourceType": "Condition",
                    "code": {
                        "text": "Risk for falls",
                        "coding": [{"system": "http://snomed.info/sct", "code": "248244005", "display": "Risk for falls"}],
                    },
                    "category": [{"text": "Risk"}],
                }
            },
            {
                "resource": {
                    "resourceType": "Observation",
                    "id": "task-dashboard-1",
                    "status": "registered",
                    "code": {"coding": [{"system": "urn:handover-pro:care", "code": "pending-task"}]},
                    "valueString": "Gasometría urgente",
                    "component": [
                        {
                            "code": {"coding": [{"system": "urn:handover-pro:component", "code": "task-category"}]},
                            "valueCodeableConcept": {
                                "coding": [{"system": "urn:handover-pro:task-category", "code": "critical-task"}]
                            },
                        },
                        {
                            "code": {"coding": [{"system": "urn:handover-pro:component", "code": "task-priority"}]},
                            "valueCodeableConcept": {
                                "coding": [{"system": "urn:handover-pro:task-priority", "code": "routine"}]
                            },
                        },
                        {
                            "code": {"coding": [{"system": "urn:handover-pro:component", "code": "task-status"}]},
                            "valueCodeableConcept": {
                                "coding": [{"system": "urn:handover-pro:task-status", "code": "pending"}]
                            },
                        },
                        {
                            "code": {"coding": [{"system": "urn:handover-pro:component", "code": "due-by"}]},
                            "valueString": "2026-03-08T11:30:00Z",
                        },
                    ],
                }
            },
            {
                "resource": {
                    "resourceType": "Device",
                    "id": "vent-dashboard",
                    "status": "active",
                    "deviceName": [{"name": "Ventilación mecánica", "type": "user-friendly"}],
                }
            },
            {
                "resource": {
                    "resourceType": "DeviceUseStatement",
                    "status": "active",
                    "subject": {"reference": bundle["entry"][0]["fullUrl"]},
                    "encounter": {"reference": encounter_reference},
                    "device": {"reference": "Device/vent-dashboard", "display": "Ventilación mecánica"},
                }
            },
        ]
    )
    return bundle


class IceaDashboardSummaryContractTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("icea-dashboard-summary")

    def _auth(self, roles):
        claims = {"sub": "auth0|dashboard-user", "roles": roles, "permissions": ["handover:write"]}
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub="auth0|dashboard-user", username="dashboard-user")
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer dashboard-token")

    def test_summary_returns_real_operational_sections(self):
        now = timezone.now()
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-dashboard-1",
            patient_id="pat-dashboard-1",
            unit_id="icu-a",
            request_id="req-dashboard-1",
            bundle_json=build_dashboard_clinical_bundle(),
            expires_at=HandoverBundleRecord.default_expiry(now=now),
        )
        IceaPipelineSnapshot.objects.create(
            request_id="req-dashboard-1",
            bundle_id="bundle-dashboard-1",
            patient_id="pat-dashboard-1",
            unit_id="icu-a",
            visible_status="retry",
            last_stage="ingest",
            stage_statuses={"ingest": {"status": "retry"}},
            last_error="upstream timeout",
        )
        IceaOutboundEvent.objects.create(
            request_id="req-dashboard-1",
            idempotency_key="req-dashboard-1",
            bundle_id="bundle-dashboard-1",
            patient_id="pat-dashboard-1",
            unit_id="icu-a",
            payload_json={"bundleId": "bundle-dashboard-1"},
            status=IceaOutboundEvent.STATUS_FAILED,
            last_error="webhook_down",
        )
        IceaBridgeRequest.objects.create(
            bridge_request_id="req-dashboard-1:immediate_provisional",
            request_id="req-dashboard-1",
            bundle_id="bundle-dashboard-1",
            patient_id="pat-dashboard-1",
            unit_id="icu-a",
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key="req-dashboard-1:immediate_provisional:abcd",
            payload_hash="abcd" * 16,
            payload_json={"contractVersion": "handover-icea-bridge-v1"},
            status=IceaBridgeRequest.STATUS_STALE,
            insufficient_evidence=True,
        )
        AuditEvent.objects.create(
            event_type="handover_timing",
            action="create",
            status="success",
            meta={"timing": {"sectionId": "sbar", "durationMs": 1500, "unitId": "icu-a"}},
        )
        self._auth(["supervisor"])

        response = self.client.get(self.url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source"], "live")
        self.assertFalse(payload["demoMode"])
        self.assertIn("alerts", payload)
        self.assertIn("outbox", payload)
        self.assertIn("pipeline", payload)
        self.assertEqual(payload["units"][0]["unitId"], "icu-a")
        self.assertEqual(payload["units"][0]["outbox"]["failed"], 1)
        self.assertEqual(payload["units"][0]["bridge"]["stale"], 1)
        self.assertEqual(payload["units"][0]["clinicalPatients"][0]["id"], "pat-dashboard-1")
        self.assertEqual(payload["units"][0]["clinicalPatients"][0]["name"], "Paciente Dashboard")
        self.assertEqual(payload["units"][0]["clinicalPatients"][0]["vitals"]["spo2"], 88)
        self.assertEqual(payload["units"][0]["clinicalPatients"][0]["devices"][0]["label"], "Ventilación mecánica")
        self.assertEqual(payload["units"][0]["clinicalPatients"][0]["pendingTasks"][0]["category"], "critical-task")
        self.assertTrue(payload["units"][0]["clinicalPatients"][0]["recentIncidentFlag"])
        self.assertEqual(payload["units"][0]["handoverTiming"][0]["sectionId"], "sbar")
        self.assertGreaterEqual(len(payload["alerts"]), 2)

    def test_summary_handles_partial_datetime_rows_without_crashing(self):
        self._auth(["supervisor"])
        last_attempt_at = timezone.now() - timezone.timedelta(minutes=7)
        delivered_at = timezone.now() - timezone.timedelta(minutes=5)

        IceaOutboundEvent.objects.create(
            request_id="req-null-dates-1",
            idempotency_key="req-null-dates-1",
            bundle_id="bundle-null-dates-1",
            patient_id="pat-null-dates-1",
            unit_id="icu-a",
            payload_json={"bundleId": "bundle-null-dates-1"},
            status=IceaOutboundEvent.STATUS_QUEUED,
        )
        delivered_event = IceaOutboundEvent.objects.create(
            request_id="req-null-dates-2",
            idempotency_key="req-null-dates-2",
            bundle_id="bundle-null-dates-2",
            patient_id="pat-null-dates-2",
            unit_id="icu-b",
            payload_json={"bundleId": "bundle-null-dates-2"},
            status=IceaOutboundEvent.STATUS_DELIVERED,
        )
        IceaOutboundEvent.objects.filter(pk=delivered_event.pk).update(
            last_attempt_at=last_attempt_at,
            delivered_at=delivered_at,
        )

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["empty"])
        self.assertEqual(payload["outbox"]["lastAttemptAt"], last_attempt_at.isoformat())
        self.assertEqual(payload["outbox"]["lastDeliveredAt"], delivered_at.isoformat())

    def test_summary_returns_recent_events_in_descending_recency_with_stable_tie_break(self):
        self._auth(["supervisor"])
        older = timezone.now() - timezone.timedelta(hours=2)
        newest = timezone.now() - timezone.timedelta(minutes=3)

        first = IceaPipelineEvent.objects.create(
            request_id="req-event-1",
            bundle_id="bundle-event-1",
            patient_id="pat-event-1",
            unit_id="icu-a",
            stage="normalize",
            action="normalize",
            status="queued",
        )
        second = IceaPipelineEvent.objects.create(
            request_id="req-event-2",
            bundle_id="bundle-event-2",
            patient_id="pat-event-2",
            unit_id="icu-a",
            stage="build-dataset",
            action="build-dataset",
            status="running",
        )
        third = IceaPipelineEvent.objects.create(
            request_id="req-event-3",
            bundle_id="bundle-event-3",
            patient_id="pat-event-3",
            unit_id="icu-a",
            stage="dashboard-summary",
            action="refresh-dashboard-summary",
            status="succeeded",
        )
        IceaPipelineEvent.objects.filter(pk=first.pk).update(created_at=older)
        IceaPipelineEvent.objects.filter(pk=second.pk).update(created_at=newest)
        IceaPipelineEvent.objects.filter(pk=third.pk).update(created_at=newest)

        response = self.client.get(self.url, {"eventsLimit": 3})

        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["id"] for event in response.json()["recentEvents"]], [third.id, second.id, first.id])

    def test_summary_returns_honest_empty_state_without_data(self):
        self._auth(["supervisor"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["empty"])
        self.assertEqual(payload["units"], [])
        self.assertEqual(payload["alerts"], [])
        self.assertEqual(payload["recentEvents"], [])

    def test_summary_requires_supervisor_or_admin(self):
        self._auth(["nurse"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)
