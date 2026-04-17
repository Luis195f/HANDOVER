import json
import types
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient


class PilotControlApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("pilot-control-summary")
        self.features_url = reverse("pilot-control-features")

    def _auth(self, *, roles):
        claims = {"sub": "auth0|pilot-control", "roles": roles, "permissions": ["handover:write"]}
        user = types.SimpleNamespace(is_authenticated=True, claims=claims, sub="auth0|pilot-control", username="pilot-control")
        self.client.force_authenticate(user=user, token=claims)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer pilot-control-token")

    def test_summary_requires_supervisor_or_admin(self):
        self._auth(roles=["nurse"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)

    def test_features_endpoint_returns_effective_backend_feature_map_for_authenticated_user(self):
        self._auth(roles=["nurse"])
        config = {
            "pilotMode": "pilot",
            "rolloutStatus": "pause",
            "explicitShadowModeForIcea": True,
            "features": {
                "icea_bridge": {
                    "mode": "shadow",
                    "enabledUnits": ["icu-a"],
                    "environmentScope": ["test", "pilot"],
                },
                "icea_patient_risk": {
                    "mode": "pilot",
                    "enabledUnits": ["icu-a"],
                    "allowedRoles": ["nurse", "supervisor", "admin"],
                    "environmentScope": ["test", "pilot"],
                },
                "governed_nnn": {
                    "mode": "pilot",
                    "enabledUnits": ["icu-a"],
                    "allowedRoles": ["nurse", "supervisor", "admin"],
                    "shadow": True,
                },
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
                "ENABLE_ICEA_BRIDGE": "true",
                "ENABLE_ICEA_PATIENT_RISK": "true",
                "SHOW_NIC_CODING": "true",
                "SHOW_NOC_OUTCOMES": "true",
            },
            clear=False,
        ):
            response = self.client.get(self.features_url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["requestedContext"]["unitId"], "icu-a")
        self.assertEqual(payload["requestedContext"]["roles"], ["nurse"])
        self.assertEqual(
            payload["features"]["icea_bridge"],
            {
                "enabled": True,
                "shadow": True,
                "pilotMode": "pilot",
                "mode": "shadow",
                "denialReason": None,
            },
        )
        self.assertEqual(payload["features"]["icea_patient_risk"]["shadow"], True)
        self.assertFalse(payload["features"]["icea_patient_risk"]["enabled"])
        self.assertEqual(payload["features"]["icea_patient_risk"]["denialReason"], "rollout_paused")
        self.assertFalse(payload["features"]["governed_nnn"]["enabled"])
        self.assertEqual(payload["features"]["governed_nnn"]["denialReason"], "shadow_mode")

    def test_features_endpoint_ignores_role_override_query_params_and_uses_authenticated_roles(self):
        self._auth(roles=["nurse"])
        config = {
            "pilotMode": "enabled",
            "features": {
                "admin_analytics": {
                    "mode": "enabled",
                    "allowedRoles": ["admin"],
                },
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
                "ENABLE_ICEA_OPS_SUMMARY": "true",
                "ENABLE_ICEA_OPS_EVENTS": "true",
            },
            clear=False,
        ):
            response = self.client.get(self.features_url, {"role": "admin"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["requestedContext"]["roles"], ["nurse"])
        self.assertFalse(payload["features"]["admin_analytics"]["enabled"])
        self.assertEqual(payload["features"]["admin_analytics"]["denialReason"], "role_out_of_scope")

    def test_admin_analytics_is_fail_closed_by_default_until_ops_flags_are_explicitly_enabled(self):
        self._auth(roles=["admin"])
        config = {
            "pilotMode": "enabled",
            "features": {
                "admin_analytics": {
                    "mode": "enabled",
                    "allowedRoles": ["admin"],
                },
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
            },
            clear=False,
        ):
            response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["features"]["admin_analytics"]["enabled"])
        self.assertEqual(payload["features"]["admin_analytics"]["denialReason"], "kill_switch_disabled")
        self.assertTrue(
            any(
                item["key"] == "admin_analytics"
                and item["effective"]
                and item["reason"] == "kill_switch_disabled"
                for item in payload["killSwitches"]
            )
        )

    def test_summary_returns_effective_flags_and_kill_switches(self):
        self._auth(roles=["admin"])
        config = {
            "pilotMode": "pilot",
            "rolloutStatus": "pause",
            "explicitShadowModeForIcea": True,
            "features": {
                "icea_bridge": {
                    "mode": "shadow",
                    "enabledUnits": ["icu-a"],
                    "environmentScope": ["test", "pilot"],
                },
                "icea_patient_risk": {
                    "mode": "pilot",
                    "enabledUnits": ["icu-a"],
                    "allowedRoles": ["supervisor", "admin"],
                    "environmentScope": ["test", "pilot"],
                },
                "admin_analytics": {
                    "mode": "shadow",
                    "allowedRoles": ["admin"],
                },
                "governed_nnn": {
                    "mode": "disabled",
                },
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
                "ENABLE_ICEA_BRIDGE": "true",
                "ENABLE_ICEA_IMMEDIATE_SCORING": "true",
                "ENABLE_ICEA_PATIENT_RISK": "true",
                "ENABLE_ICEA_OPS_SUMMARY": "true",
                "ENABLE_ICEA_OPS_EVENTS": "true",
                "SHOW_NIC_CODING": "true",
            },
            clear=False,
        ):
            response = self.client.get(self.url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["pilotMode"], "pilot")
        self.assertEqual(payload["rolloutStatus"], "pause")
        self.assertTrue(payload["explicitShadowModeForIcea"])
        self.assertEqual(payload["requestedContext"]["unitId"], "icu-a")
        self.assertEqual(payload["features"]["icea_bridge"]["mode"], "shadow")
        self.assertTrue(payload["features"]["icea_bridge"]["enabled"])
        self.assertTrue(payload["features"]["icea_bridge"]["shadowMode"])
        self.assertEqual(payload["features"]["icea_bridge"]["baseSwitches"], ["ENABLE_ICEA_BRIDGE"])
        self.assertEqual(
            payload["features"]["governed_nnn"]["baseSwitches"],
            ["SHOW_NIC_CODING", "SHOW_NOC_OUTCOMES"],
        )
        self.assertEqual(payload["features"]["icea_patient_risk"]["denialReason"], "rollout_paused")
        self.assertFalse(payload["features"]["icea_patient_risk"]["enabled"])
        self.assertEqual(payload["features"]["governed_nnn"]["mode"], "disabled")
        self.assertTrue(
            any(
                item["key"] == "governed_nnn" and item["effective"]
                for item in payload["killSwitches"]
            )
        )

    def test_pause_forces_icea_shadow_and_disables_non_shadow_surface(self):
        self._auth(roles=["admin"])
        config = {
            "pilotMode": "enabled",
            "rolloutStatus": "pause",
            "features": {
                "icea_bridge": {
                    "mode": "enabled",
                    "enabledUnits": ["icu-a"],
                    "environmentScope": ["test"],
                },
                "icea_patient_risk": {
                    "mode": "enabled",
                    "enabledUnits": ["icu-a"],
                    "allowedRoles": ["nurse", "supervisor", "admin"],
                    "environmentScope": ["test"],
                },
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
                "ENABLE_ICEA_BRIDGE": "true",
                "ENABLE_ICEA_IMMEDIATE_SCORING": "true",
                "ENABLE_ICEA_PATIENT_RISK": "true",
            },
            clear=False,
        ):
            response = self.client.get(self.url, {"unitId": "icu-a", "role": "nurse"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["rolloutStatus"], "pause")
        self.assertTrue(payload["features"]["icea_bridge"]["enabled"])
        self.assertTrue(payload["features"]["icea_bridge"]["shadowMode"])
        self.assertFalse(payload["features"]["icea_patient_risk"]["enabled"])
        self.assertTrue(payload["features"]["icea_patient_risk"]["shadowMode"])
        self.assertEqual(payload["features"]["icea_patient_risk"]["denialReason"], "rollout_paused")

    def test_no_go_disables_pilot_features_even_when_base_flags_are_on(self):
        self._auth(roles=["admin"])
        config = {
            "pilotMode": "enabled",
            "rolloutStatus": "no-go",
            "features": {
                "admin_analytics": {"mode": "enabled"},
                "governed_nnn": {"mode": "enabled"},
            },
        }

        with self.settings(HANDOVER_DEPLOYMENT_MODE="test"), patch.dict(
            "os.environ",
            {
                "HANDOVER_PILOT_CONTROL_JSON": json.dumps(config),
                "ENABLE_ICEA_OPS_SUMMARY": "true",
                "ENABLE_ICEA_OPS_EVENTS": "true",
                "SHOW_NIC_CODING": "true",
                "SHOW_NOC_OUTCOMES": "true",
            },
            clear=False,
        ):
            response = self.client.get(self.url, {"unitId": "icu-a"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["rolloutStatus"], "no-go")
        self.assertFalse(payload["features"]["admin_analytics"]["enabled"])
        self.assertEqual(payload["features"]["admin_analytics"]["denialReason"], "rollout_no_go")
        self.assertFalse(payload["features"]["governed_nnn"]["enabled"])
        self.assertEqual(payload["features"]["governed_nnn"]["denialReason"], "rollout_no_go")
