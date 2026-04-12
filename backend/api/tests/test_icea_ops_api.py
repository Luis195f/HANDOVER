import json
import os
import types
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from backend.api.models import IceaBridgeRequest, IceaOutboundEvent, IceaPipelineEvent, IceaPipelineSnapshot


class IceaOpsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.summary_url = reverse("icea-ops-summary")
        self.events_url = reverse("icea-ops-events")
        self.unit_url = reverse("icea-ops-unit", kwargs={"unit_id": "icu-a"})

    def _auth(self, *, roles, unit_ids=("icu-a",)):
        claims = {"sub": "auth0|ops-user", "roles": roles, "permissions": ["handover:write"], "unitIds": list(unit_ids)}
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub="auth0|ops-user", username="ops-user")
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer ops-token")

    def _seed_ops_data(self):
        now = timezone.now()
        IceaOutboundEvent.objects.create(
            request_id="req-ops-1",
            idempotency_key="req-ops-1",
            bundle_id="bundle-ops-1",
            patient_id="pat-sensitive-1",
            unit_id="icu-a",
            payload_json={"bundleId": "bundle-ops-1", "patientId": "pat-sensitive-1"},
            status=IceaOutboundEvent.STATUS_DELIVERED,
            attempts=2,
            last_attempt_at=now - timezone.timedelta(minutes=4),
            delivered_at=now - timezone.timedelta(minutes=3),
        )
        IceaOutboundEvent.objects.create(
            request_id="req-ops-2",
            idempotency_key="req-ops-2",
            bundle_id="bundle-ops-2",
            patient_id="pat-sensitive-2",
            unit_id="icu-a",
            payload_json={"bundleId": "bundle-ops-2", "patientId": "pat-sensitive-2"},
            status=IceaOutboundEvent.STATUS_RETRY,
            attempts=3,
            last_error="ConnectTimeout",
            last_attempt_at=now - timezone.timedelta(minutes=2),
            next_retry_at=now + timezone.timedelta(minutes=5),
        )
        IceaBridgeRequest.objects.create(
            bridge_request_id="req-ops-1:immediate_provisional",
            request_id="req-ops-1",
            bundle_id="bundle-ops-1",
            patient_id="pat-sensitive-1",
            unit_id="icu-a",
            shift="morning",
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key="req-ops-1:hash",
            payload_hash="abcd" * 16,
            payload_json={"contractVersion": "handover-icea-bridge-v1"},
            status=IceaBridgeRequest.STATUS_PENDING,
            provisional=True,
            attempts=2,
            sent_at=now - timezone.timedelta(minutes=6),
            received_at=now - timezone.timedelta(minutes=5),
        )
        IceaBridgeRequest.objects.create(
            bridge_request_id="req-ops-2:immediate_provisional",
            request_id="req-ops-2",
            bundle_id="bundle-ops-2",
            patient_id="pat-sensitive-2",
            unit_id="icu-a",
            shift="morning",
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            idempotency_key="req-ops-2:hash",
            payload_hash="dcba" * 16,
            payload_json={"contractVersion": "handover-icea-bridge-v1"},
            status=IceaBridgeRequest.STATUS_STALE,
            last_error="stale_remote_status",
        )
        IceaPipelineSnapshot.objects.create(
            request_id="req-ops-1",
            bundle_id="bundle-ops-1",
            patient_id="pat-sensitive-1",
            unit_id="icu-a",
            visible_status="running",
            last_stage="normalize",
            stage_statuses={"normalize": {"status": "running"}},
        )
        IceaPipelineEvent.objects.create(
            request_id="req-ops-2",
            bundle_id="bundle-ops-2",
            patient_id="pat-sensitive-2",
            unit_id="icu-a",
            stage="normalize",
            action="normalize",
            status="failed",
            source="manual-action",
            detail="http_503",
            http_status=503,
        )

    def test_summary_requires_supervisor_or_admin(self):
        self._auth(roles=["nurse"])

        response = self.client.get(self.summary_url)

        self.assertEqual(response.status_code, 403)

    def test_summary_returns_safe_operational_metrics(self):
        self._seed_ops_data()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.summary_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["available"])
        self.assertEqual(payload["state"], "stale")
        self.assertEqual(payload["counts"]["handoversExported"], 2)
        self.assertEqual(payload["counts"]["outbox"]["retry"], 1)
        self.assertEqual(payload["counts"]["bridge"]["pending"], 1)
        self.assertEqual(payload["counts"]["bridge"]["stale"], 1)
        self.assertEqual(payload["units"][0]["unitId"], "icu-a")
        self.assertEqual(payload["units"][0]["pendingCount"], 3)
        self.assertNotIn("patientId", str(payload))

    def test_events_return_safe_cross_source_feed(self):
        self._seed_ops_data()
        self._auth(roles=["admin"])

        response = self.client.get(self.events_url, {"unitId": "icu-a", "limit": 5})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["available"])
        self.assertGreaterEqual(payload["count"], 3)
        sources = {item["source"] for item in payload["results"]}
        self.assertIn("outbox", sources)
        self.assertIn("bridge", sources)
        self.assertIn("pipeline", sources)
        self.assertNotIn("patientId", str(payload))

    def test_unit_endpoint_returns_shift_and_recent_events(self):
        self._seed_ops_data()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.unit_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["unitId"], "icu-a")
        self.assertTrue(payload["available"])
        self.assertEqual(payload["shifts"][0]["shift"], "morning")
        self.assertGreaterEqual(len(payload["recentEvents"]), 3)
        self.assertNotIn("patientId", str(payload))

    def test_events_forbid_unit_outside_supervisor_scope(self):
        self._seed_ops_data()
        self._auth(roles=["supervisor"], unit_ids=("icu-a",))

        response = self.client.get(self.events_url, {"unitId": "ward-z"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "icea_ops_forbidden_unit")

    @patch.dict(os.environ, {"ENABLE_ICEA_OPS_SUMMARY": "false"}, clear=False)
    def test_summary_flag_disabled_is_explicit(self):
        self._auth(roles=["admin"])

        response = self.client.get(self.summary_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["scope"], "summary")
        self.assertEqual(payload["units"], [])
        self.assertEqual(payload["errors"], [])
        self.assertEqual(payload["pendingCount"], 0)
        self.assertTrue(payload["empty"])
        self.assertIn("flags", payload)
        self.assertEqual(payload["unavailableReason"], "icea_ops_summary_disabled")

    @patch.dict(
        os.environ,
        {
            "ENABLE_ICEA_OPS_SUMMARY": "true",
            "ENABLE_ICEA_OPS_EVENTS": "true",
            "HANDOVER_PILOT_CONTROL_JSON": json.dumps(
                {
                    "features": {
                        "admin_analytics": {
                            "mode": "disabled",
                        }
                    }
                }
            ),
        },
        clear=False,
    )
    def test_summary_control_plane_kill_switch_is_parseable(self):
        self._auth(roles=["admin"])

        response = self.client.get(self.summary_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["scope"], "summary")
        self.assertEqual(payload["unavailableReason"], "icea_ops_summary_disabled")
        self.assertEqual(payload["units"], [])

    @patch.dict(os.environ, {"ENABLE_ICEA_OPS_EVENTS": "false"}, clear=False)
    def test_events_flag_disabled_returns_parseable_empty_contract(self):
        self._auth(roles=["supervisor"])

        response = self.client.get(self.events_url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["scope"], "events")
        self.assertEqual(payload["unitId"], "icu-a")
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["results"], [])
        self.assertIn("flags", payload)
        self.assertEqual(payload["unavailableReason"], "icea_ops_events_disabled")

    @patch.dict(
        os.environ,
        {
            "ENABLE_ICEA_OPS_EVENTS": "true",
            "HANDOVER_PILOT_CONTROL_JSON": json.dumps(
                {
                    "features": {
                        "admin_analytics": {
                            "mode": "disabled",
                        }
                    }
                }
            ),
        },
        clear=False,
    )
    def test_events_control_plane_kill_switch_is_parseable(self):
        self._auth(roles=["admin"])

        response = self.client.get(self.events_url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["scope"], "events")
        self.assertEqual(payload["unavailableReason"], "icea_ops_events_disabled")
        self.assertEqual(payload["results"], [])

    @patch.dict(os.environ, {"ENABLE_ICEA_OPS_SUMMARY": "false"}, clear=False)
    def test_unit_flag_disabled_returns_parseable_empty_contract(self):
        self._auth(roles=["admin"])

        response = self.client.get(self.unit_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["scope"], "unit")
        self.assertEqual(payload["unitId"], "icu-a")
        self.assertEqual(payload["state"], "degraded")
        self.assertEqual(payload["recentEvents"], [])
        self.assertEqual(payload["shifts"], [])
        self.assertEqual(payload["errors"], [])
        self.assertIn("flags", payload)
        self.assertEqual(payload["unavailableReason"], "icea_ops_unit_disabled")

    def test_unit_without_data_degrades_explicitly(self):
        self._auth(roles=["supervisor"], unit_ids=("icu-a", "ward-z"))

        response = self.client.get(reverse("icea-ops-unit", kwargs={"unit_id": "ward-z"}))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertEqual(payload["state"], "degraded")
        self.assertEqual(payload["recentEvents"], [])
        self.assertEqual(payload["shifts"], [])
        self.assertEqual(payload["errors"], [])
        self.assertEqual(payload["unavailableReason"], "icea_ops_unit_no_data")
