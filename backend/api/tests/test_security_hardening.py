from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from django.test import TestCase, override_settings


REPO_ROOT = Path(__file__).resolve().parents[3]


class SecurityHardeningSettingsTests(TestCase):
    def _run_settings_import(self, env_overrides: dict[str, str | None]) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.setdefault("PYTHONPATH", str(REPO_ROOT))
        env["DJANGO_SETTINGS_MODULE"] = "backend.settings"
        env["SECRET_KEY"] = "test-secret"
        env["DJANGO_DEBUG"] = "false"
        env.pop("PYTEST_CURRENT_TEST", None)
        env["HANDOVER_ALLOWED_ORIGINS"] = ""

        for key, value in env_overrides.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value

        return subprocess.run(
            [sys.executable, "-c", "import backend.settings"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
        )

    def test_prod_requires_handover_allowed_origins(self):
        result = self._run_settings_import({"HANDOVER_ALLOWED_ORIGINS": ""})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HANDOVER_ALLOWED_ORIGINS is required in production", result.stderr)

    def test_invalid_origin_value_fails_fast(self):
        result = self._run_settings_import({"HANDOVER_ALLOWED_ORIGINS": "not-an-origin"})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only accepts absolute http(s) origins", result.stderr)


class SecurityHardeningCORSTests(TestCase):
    @override_settings(
        CORS_ALLOW_ALL_ORIGINS=False,
        CORS_ALLOWED_ORIGINS=["https://app.handover.test"],
    )
    def test_cors_allows_configured_origin(self):
        response = self.client.get("/api/ping", HTTP_ORIGIN="https://app.handover.test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://app.handover.test")

    @override_settings(
        CORS_ALLOW_ALL_ORIGINS=False,
        CORS_ALLOWED_ORIGINS=["https://app.handover.test"],
    )
    def test_cors_blocks_unconfigured_origin(self):
        response = self.client.get("/api/ping", HTTP_ORIGIN="https://evil.example")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
