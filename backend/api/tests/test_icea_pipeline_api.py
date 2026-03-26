import json
import types
from unittest.mock import Mock, patch

import httpx
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from backend.api.models import IceaPipelineEvent, IceaPipelineSnapshot


class IceaPipelineApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.status_url = reverse("icea-pipeline-status")
        self.events_url = reverse("icea-pipeline-events")
        self.summary_url = reverse("icea-dashboard-summary")
        self.normalize_url = reverse("icea-pipeline-action", kwargs={"action": "normalize"})
        self.refresh_summary_url = reverse("icea-pipeline-action", kwargs={"action": "refresh-dashboard-summary"})

    def _auth(self, *, roles, sub="auth0|admin-1"):
        claims = {"sub": sub, "roles": roles, "permissions": ["handover:write"]}
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub=sub, username=sub)
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")

    def _create_snapshot(self, **overrides):
        payload = {
            "request_id": "req-icea-001",
            "bundle_id": "bundle-icea-001",
            "patient_id": "pat-001",
            "unit_id": "icu-a",
            "visible_status": "accepted",
            "last_stage": "handover",
            "stage_statuses": {"handover": {"status": "accepted"}},
        }
        payload.update(overrides)
        return IceaPipelineSnapshot.objects.create(**payload)

    def test_status_requires_admin_or_supervisor(self):
        self._create_snapshot()
        self._auth(roles=["nurse"])

        response = self.client.get(self.status_url, {"requestId": "req-icea-001"})

        self.assertEqual(response.status_code, 403)

    def test_status_returns_404_when_snapshot_missing(self):
        self._auth(roles=["supervisor"])

        response = self.client.get(self.status_url, {"requestId": "missing"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "icea_snapshot_not_found")

    def test_status_without_selector_returns_400_and_does_not_touch_snapshots(self):
        snapshot = self._create_snapshot()
        original_updated_at = snapshot.updated_at
        snapshot_count = IceaPipelineSnapshot.objects.count()
        event_count = IceaPipelineEvent.objects.count()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.status_url)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "missing_selector")
        self.assertEqual(IceaPipelineSnapshot.objects.count(), snapshot_count)
        self.assertEqual(IceaPipelineEvent.objects.count(), event_count)
        snapshot.refresh_from_db()
        self.assertEqual(snapshot.updated_at, original_updated_at)
        self.assertEqual(snapshot.last_stage, "handover")

    def test_status_returns_local_snapshot_and_remote_error_when_icea_not_configured(self):
        self._create_snapshot()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.status_url, {"requestId": "req-icea-001"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["snapshot"]["requestId"], "req-icea-001")
        self.assertEqual(payload["snapshot"]["visibleStatus"], "accepted")
        self.assertEqual(payload["remoteError"]["code"], "icea_pipeline_not_configured")

    @patch.dict(
        "os.environ",
        {
            "HANDOVER_PILOT_CONTROL_JSON": json.dumps(
                {
                    "features": {
                        "admin_analytics": {
                            "mode": "pilot",
                            "allowedRoles": ["admin"],
                        }
                    }
                }
            )
        },
        clear=False,
    )
    def test_status_respects_role_scoped_admin_analytics_control_plane(self):
        self._create_snapshot()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.status_url, {"requestId": "req-icea-001"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "role_out_of_scope")

    @patch.dict(
        "os.environ",
        {
            "HANDOVER_PILOT_CONTROL_JSON": json.dumps(
                {
                    "pilotMode": "enabled",
                    "rolloutStatus": "no-go",
                    "features": {
                        "admin_analytics": {
                            "mode": "enabled",
                            "allowedRoles": ["supervisor", "admin"],
                        }
                    },
                }
            ),
            "ENABLE_ICEA_OPS_SUMMARY": "true",
            "ENABLE_ICEA_OPS_EVENTS": "true",
        },
        clear=False,
    )
    def test_status_respects_rollout_no_go_and_disables_admin_analytics(self):
        self._create_snapshot()
        self._auth(roles=["supervisor"])

        response = self.client.get(self.status_url, {"requestId": "req-icea-001"})

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "rollout_no_go")

    @patch.dict(
        "os.environ",
        {
            "ICEA_API_BASE_URL": "https://icea.example",
            "ICEA_API_BEARER_TOKEN": "svc-token",
        },
        clear=False,
    )
    @patch("backend.api.icea_pipeline.httpx.request")
    def test_status_refresh_updates_snapshot_from_remote_payload(self, mock_request):
        self._create_snapshot()
        self._auth(roles=["supervisor"])
        remote = Mock()
        remote.status_code = 200
        remote.text = '{"status":"running","stages":{"normalize":{"status":"running"}}}'
        remote.headers = {"Content-Type": "application/json"}
        remote.json.return_value = {
            "status": "running",
            "stages": {"normalize": {"status": "running"}},
        }
        mock_request.return_value = remote

        response = self.client.get(self.status_url, {"requestId": "req-icea-001"})

        self.assertEqual(response.status_code, 200)
        snapshot = IceaPipelineSnapshot.objects.get(request_id="req-icea-001")
        self.assertEqual(snapshot.visible_status, "running")
        self.assertEqual(snapshot.last_stage, "normalize")
        self.assertEqual(response.json()["snapshot"]["stageStatuses"]["normalize"]["status"], "running")

    def test_events_endpoint_filters_by_unit(self):
        snapshot = self._create_snapshot()
        IceaPipelineEvent.objects.create(
            snapshot=snapshot,
            request_id=snapshot.request_id,
            bundle_id=snapshot.bundle_id,
            patient_id=snapshot.patient_id,
            unit_id="icu-a",
            stage="ingest",
            action="ingest",
            status="delivered",
            source="outbox-delivered",
        )
        IceaPipelineEvent.objects.create(
            request_id="req-other",
            bundle_id="bundle-other",
            patient_id="pat-other",
            unit_id="ward-b",
            stage="normalize",
            action="normalize",
            status="failed",
            source="manual-action",
        )
        self._auth(roles=["supervisor"])

        response = self.client.get(self.events_url, {"unitId": "icu-a", "limit": 10})

        self.assertEqual(response.status_code, 200)
        payload = response.json()["results"]
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["unitId"], "icu-a")
        self.assertEqual(payload[0]["stage"], "ingest")

    def test_summary_endpoint_returns_stable_contract(self):
        self._create_snapshot(visible_status="retry", unit_id="icu-a")
        self._auth(roles=["supervisor"])

        response = self.client.get(self.summary_url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("generatedAt", payload)
        self.assertIn("units", payload)
        self.assertIn("recentEvents", payload)
        self.assertEqual(payload["units"][0]["unitId"], "icu-a")
        self.assertEqual(payload["units"][0]["retry"], 1)

    def test_actions_require_admin_role(self):
        self._create_snapshot()
        self._auth(roles=["supervisor"])

        response = self.client.post(self.normalize_url, data={"requestId": "req-icea-001"}, format="json")

        self.assertEqual(response.status_code, 403)

    def test_normalize_without_selector_returns_400_and_does_not_touch_snapshots(self):
        snapshot = self._create_snapshot()
        original_updated_at = snapshot.updated_at
        snapshot_count = IceaPipelineSnapshot.objects.count()
        event_count = IceaPipelineEvent.objects.count()
        self._auth(roles=["admin"])

        response = self.client.post(self.normalize_url, data={}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "missing_selector")
        self.assertEqual(IceaPipelineSnapshot.objects.count(), snapshot_count)
        self.assertEqual(IceaPipelineEvent.objects.count(), event_count)
        snapshot.refresh_from_db()
        self.assertEqual(snapshot.updated_at, original_updated_at)
        self.assertEqual(snapshot.last_stage, "handover")

    def test_refresh_dashboard_summary_without_unit_id_returns_400_and_does_not_touch_snapshots(self):
        snapshot = self._create_snapshot()
        original_updated_at = snapshot.updated_at
        snapshot_count = IceaPipelineSnapshot.objects.count()
        event_count = IceaPipelineEvent.objects.count()
        self._auth(roles=["admin"])

        response = self.client.post(self.refresh_summary_url, data={}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "missing_unit_id")
        self.assertEqual(IceaPipelineSnapshot.objects.count(), snapshot_count)
        self.assertEqual(IceaPipelineEvent.objects.count(), event_count)
        snapshot.refresh_from_db()
        self.assertEqual(snapshot.updated_at, original_updated_at)
        self.assertEqual(snapshot.last_stage, "handover")

    @patch.dict(
        "os.environ",
        {
            "ICEA_API_BASE_URL": "https://icea.example",
            "ICEA_API_BEARER_TOKEN": "svc-token",
        },
        clear=False,
    )
    @patch("backend.api.icea_pipeline.httpx.request")
    def test_normalize_action_returns_200_and_persists_snapshot(self, mock_request):
        self._create_snapshot()
        self._auth(roles=["admin"])
        remote = Mock()
        remote.status_code = 200
        remote.text = '{"status":"completed","requestId":"req-icea-001","bundleId":"bundle-icea-001"}'
        remote.headers = {"Content-Type": "application/json"}
        remote.json.return_value = {
            "status": "completed",
            "requestId": "req-icea-001",
            "bundleId": "bundle-icea-001",
        }
        mock_request.return_value = remote

        response = self.client.post(self.normalize_url, data={"requestId": "req-icea-001"}, format="json")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["action"], "normalize")
        self.assertEqual(payload["snapshot"]["lastStage"], "normalize")
        self.assertEqual(payload["snapshot"]["visibleStatus"], "succeeded")
        self.assertTrue(IceaPipelineEvent.objects.filter(stage="normalize", status="succeeded").exists())

    @patch.dict(
        "os.environ",
        {
            "ICEA_API_BASE_URL": "https://icea.example",
            "ICEA_API_BEARER_TOKEN": "svc-token",
        },
        clear=False,
    )
    @patch("backend.api.icea_pipeline.httpx.request", side_effect=httpx.ConnectTimeout("upstream down"))
    def test_action_transport_error_returns_502(self, _mock_request):
        self._create_snapshot()
        self._auth(roles=["admin"])

        response = self.client.post(self.normalize_url, data={"requestId": "req-icea-001"}, format="json")

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["code"], "icea_transport_error")

    @patch.dict(
        "os.environ",
        {
            "ICEA_API_BASE_URL": "https://icea.example",
            "ICEA_API_BEARER_TOKEN": "svc-token",
        },
        clear=False,
    )
    @patch("backend.api.icea_pipeline.httpx.request")
    def test_refresh_dashboard_summary_persists_unit_event(self, mock_request):
        self._auth(roles=["admin"])
        remote = Mock()
        remote.status_code = 200
        remote.text = '{"summary":{"unitId":"icu-a","counts":{"completed":4}},"status":"completed"}'
        remote.headers = {"Content-Type": "application/json"}
        remote.json.return_value = {
            "summary": {"unitId": "icu-a", "counts": {"completed": 4}},
            "status": "completed",
        }
        mock_request.return_value = remote

        response = self.client.post(self.refresh_summary_url, data={"unitId": "icu-a"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            IceaPipelineEvent.objects.filter(
                unit_id="icu-a",
                stage="dashboard-summary",
                status="succeeded",
            ).exists()
        )


