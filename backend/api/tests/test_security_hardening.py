from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from backend.api.clinical_storage import (
    ClinicalBundleStorageError,
    decrypt_bundle_document,
    encrypt_bundle_document,
)
from backend.api.icea_pipeline import load_icea_pipeline_settings
from backend.api.management.commands.prune_sensitive_records import prune_exception_references
from backend.api.models import ExceptionHandoverShift
from backend.api.views_exception_handover import _read


REPO_ROOT = Path(__file__).resolve().parents[3]


class SecurityHardeningSettingsTests(TestCase):
    def _run_settings_import(self, env_overrides: dict[str, str | None]) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.setdefault("PYTHONPATH", str(REPO_ROOT))
        env["DJANGO_SETTINGS_MODULE"] = "backend.settings"
        env["SECRET_KEY"] = "test-secret"
        env["DJANGO_DEBUG"] = "false"
        env["HANDOVER_SIGNATURE_DISABLED"] = "false"
        env["HANDOVER_FHIR_VALIDATION_MODE"] = "local"
        env["HANDOVER_PRIVATE_KEY_PATH"] = "C:/keys/private.pem"
        env["HANDOVER_PUBLIC_KEY_PATH"] = "C:/keys/public.pem"
        env["HANDOVER_BUNDLE_ENCRYPTION_KEY"] = "dedicated-synthetic-key-32-bytes-long"
        env.pop("ICEA_API_VERIFY_TLS", None)
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

    def test_prod_requires_auth0_configuration(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "AUTH0_ISSUER_BASE_URL": "",
            "AUTH0_AUDIENCE": "",
            "OIDC_ISSUER": "",
            "OIDC_AUDIENCE": "",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AUTH0_ISSUER_BASE_URL", result.stderr)
        self.assertIn("AUTH0_AUDIENCE", result.stderr)

    def test_non_local_debug_true_fails_fast_even_with_auth0_configured(self):
        result = self._run_settings_import({
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "DJANGO_DEBUG": "true",
            "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
            "AUTH0_AUDIENCE": "handover-api",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_DEBUG=true is only allowed", result.stderr)

    def test_explicit_local_debug_can_run_without_auth0(self):
        result = self._run_settings_import({
            "HANDOVER_DEPLOYMENT_MODE": "development",
            "DJANGO_DEBUG": "true",
            "HANDOVER_ALLOWED_ORIGINS": "",
            "AUTH0_ISSUER_BASE_URL": "",
            "AUTH0_AUDIENCE": "",
            "OIDC_ISSUER": "",
            "OIDC_AUDIENCE": "",
        })

        self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_test_deployment_mode_without_real_test_runner_still_requires_auth0(self):
        result = self._run_settings_import({
            "HANDOVER_DEPLOYMENT_MODE": "test",
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "AUTH0_ISSUER_BASE_URL": "",
            "AUTH0_AUDIENCE": "",
            "OIDC_ISSUER": "",
            "OIDC_AUDIENCE": "",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AUTH0_ISSUER_BASE_URL", result.stderr)
        self.assertIn("AUTH0_AUDIENCE", result.stderr)

    def test_prod_reports_multiple_strict_startup_failures_without_masking_later_checks(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "",
            "AUTH0_ISSUER_BASE_URL": "",
            "AUTH0_AUDIENCE": "",
            "OIDC_ISSUER": "",
            "OIDC_AUDIENCE": "",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Startup hardening validation failed", result.stderr)
        self.assertIn("HANDOVER_ALLOWED_ORIGINS is required in production", result.stderr)
        self.assertIn("AUTH0_ISSUER_BASE_URL", result.stderr)
        self.assertIn("AUTH0_AUDIENCE", result.stderr)

    def test_pilot_rejects_signature_disabled_flag(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_SIGNATURE_DISABLED": "true",
            "HANDOVER_PRIVATE_KEY_PATH": "C:/keys/private.pem",
            "HANDOVER_PUBLIC_KEY_PATH": "C:/keys/public.pem",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HANDOVER_SIGNATURE_DISABLED cannot be enabled in pilot/production", result.stderr)

    def test_pilot_requires_explicit_fhir_validation_mode(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_FHIR_VALIDATION_MODE": "",
            "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
            "AUTH0_AUDIENCE": "handover-api",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HANDOVER_FHIR_VALIDATION_MODE must be set explicitly in pilot/production", result.stderr)

    def test_pilot_rejects_fhir_validation_mode_off(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_FHIR_VALIDATION_MODE": "off",
            "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
            "AUTH0_AUDIENCE": "handover-api",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid HANDOVER_FHIR_VALIDATION_MODE for pilot/production: 'off'", result.stderr)
        self.assertIn("Allowed values: local, remote, strict", result.stderr)
        self.assertIn("'off' and any other invalid value are not allowed in strict environments", result.stderr)

    def test_pilot_rejects_invalid_fhir_validation_mode_value(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_FHIR_VALIDATION_MODE": "remtoe",
            "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
            "AUTH0_AUDIENCE": "handover-api",
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid HANDOVER_FHIR_VALIDATION_MODE for pilot/production: 'remtoe'", result.stderr)
        self.assertIn("Allowed values: local, remote, strict", result.stderr)

    def test_pilot_accepts_valid_fhir_validation_mode(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_FHIR_VALIDATION_MODE": "remote",
            "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
            "AUTH0_AUDIENCE": "handover-api",
        })

        self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_pilot_requires_signature_key_paths(self):
        result = self._run_settings_import({
            "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
            "HANDOVER_DEPLOYMENT_MODE": "pilot",
            "HANDOVER_SIGNATURE_DISABLED": "false",
            "HANDOVER_PRIVATE_KEY_PATH": None,
            "HANDOVER_PUBLIC_KEY_PATH": None,
        })

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HANDOVER_PRIVATE_KEY_PATH and HANDOVER_PUBLIC_KEY_PATH are required in pilot/production", result.stderr)

    def test_strict_modes_require_valid_dedicated_key(self):
        for mode in ("pilot", "production"):
            for configured in (None, "short", " " * 32, "test-secret"):
                with self.subTest(mode=mode, configured=configured):
                    result = self._run_settings_import({
                        "HANDOVER_DEPLOYMENT_MODE": mode,
                        "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
                        "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
                        "AUTH0_AUDIENCE": "handover-api",
                        "HANDOVER_BUNDLE_ENCRYPTION_KEY": configured,
                    })
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("HANDOVER_BUNDLE_ENCRYPTION_KEY", result.stderr)
                    self.assertNotIn("test-secret", result.stderr)

    def test_strict_modes_reject_effectively_shared_key(self):
        for mode in ("pilot", "production"):
            result = self._run_settings_import({
                "HANDOVER_DEPLOYMENT_MODE": mode,
                "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
                "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
                "AUTH0_AUDIENCE": "handover-api",
                "SECRET_KEY": "synthetic-shared-secret-material-32-bytes",
                "HANDOVER_BUNDLE_ENCRYPTION_KEY": "synthetic-shared-secret-material-32-bytes",
            })
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must differ from SECRET_KEY", result.stderr)
            self.assertNotIn("synthetic-shared-secret-material-32-bytes", result.stderr)

    def test_strict_modes_reject_effectively_disabled_icea_tls(self):
        for mode in ("pilot", "production"):
            for raw in ("false", "0", "", "invalid", " off "):
                with self.subTest(mode=mode, raw=raw):
                    result = self._run_settings_import({
                        "HANDOVER_DEPLOYMENT_MODE": mode,
                        "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
                        "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
                        "AUTH0_AUDIENCE": "handover-api",
                        "ICEA_API_VERIFY_TLS": raw,
                    })
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ICEA_API_VERIFY_TLS", result.stderr)
                    with patch.dict(os.environ, {"ICEA_API_VERIFY_TLS": raw}):
                        self.assertFalse(load_icea_pipeline_settings().verify_tls)

    def test_strict_modes_start_with_dedicated_key_and_tls(self):
        for mode in ("pilot", "production"):
            result = self._run_settings_import({
                "HANDOVER_DEPLOYMENT_MODE": mode,
                "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
                "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
                "AUTH0_AUDIENCE": "handover-api",
                "ICEA_API_VERIFY_TLS": " yes ",
            })
            self.assertEqual(result.returncode, 0, msg=result.stderr)

    def test_demo_and_test_keep_legacy_configuration(self):
        for mode in ("demo", "test"):
            result = self._run_settings_import({
                "HANDOVER_DEPLOYMENT_MODE": mode,
                "HANDOVER_ALLOWED_ORIGINS": "https://app.handover.test",
                "AUTH0_ISSUER_BASE_URL": "https://issuer.example",
                "AUTH0_AUDIENCE": "handover-api",
                "HANDOVER_BUNDLE_ENCRYPTION_KEY": None,
                "ICEA_API_VERIFY_TLS": "false",
            })
            self.assertEqual(result.returncode, 0, msg=result.stderr)


class StrictClinicalStorageTests(TestCase):
    def test_strict_mode_round_trip_and_legacy_rejection(self):
        bundle = {"resourceType": "Bundle", "type": "transaction", "entry": []}
        with override_settings(
            HANDOVER_STRICT_SECURITY_MODE=False,
            SECRET_KEY="synthetic-legacy-secret",
            HANDOVER_BUNDLE_ENCRYPTION_KEY="",
        ):
            legacy, legacy_metadata = encrypt_bundle_document(bundle)
        with override_settings(
            HANDOVER_STRICT_SECURITY_MODE=True,
            SECRET_KEY="synthetic-legacy-secret",
            HANDOVER_BUNDLE_ENCRYPTION_KEY="dedicated-synthetic-key-32-bytes-long",
        ):
            dedicated, metadata = encrypt_bundle_document(bundle)
            self.assertEqual(metadata["key_source"], "env")
            self.assertEqual(decrypt_bundle_document(dedicated, encryption_metadata=metadata), bundle)
            with self.assertRaises(ClinicalBundleStorageError):
                decrypt_bundle_document(legacy, encryption_metadata=legacy_metadata)
        with override_settings(
            HANDOVER_STRICT_SECURITY_MODE=False,
            SECRET_KEY="synthetic-legacy-secret",
            HANDOVER_BUNDLE_ENCRYPTION_KEY="dedicated-synthetic-key-32-bytes-long",
        ):
            self.assertEqual(decrypt_bundle_document(legacy, encryption_metadata=legacy_metadata), bundle)

    @override_settings(HANDOVER_STRICT_SECURITY_MODE=True, HANDOVER_BUNDLE_ENCRYPTION_KEY="")
    def test_strict_encryption_never_falls_back_to_secret_key(self):
        with self.assertRaises(ClinicalBundleStorageError):
            encrypt_bundle_document({"resourceType": "Bundle"})

    def test_legacy_c12_read_and_pruning_fail_without_mutation_in_strict_mode(self):
        now = timezone.now()
        with override_settings(
            HANDOVER_STRICT_SECURITY_MODE=False,
            SECRET_KEY="synthetic-legacy-secret",
            HANDOVER_BUNDLE_ENCRYPTION_KEY="",
        ):
            envelope, metadata = encrypt_bundle_document({"acceptedReferences": [
                {"expiresAt": (now - timedelta(days=1)).isoformat()}
            ]})
        shift = ExceptionHandoverShift.objects.create(
            unit_id="unit-synthetic",
            period_start=now - timedelta(hours=1),
            period_end=now + timedelta(hours=1),
            description="synthetic",
            creator_sub="synthetic-actor",
            creation_key=uuid.uuid4(),
            creation_hash="0" * 64,
            state_json=envelope,
            encryption_metadata=metadata,
            expires_at=now + timedelta(days=1),
        )
        with override_settings(
            HANDOVER_STRICT_SECURITY_MODE=True,
            SECRET_KEY="synthetic-legacy-secret",
            HANDOVER_BUNDLE_ENCRYPTION_KEY="dedicated-synthetic-key-32-bytes-long",
        ):
            with self.assertRaises(ClinicalBundleStorageError):
                _read(shift)
            with self.assertRaises(ClinicalBundleStorageError):
                prune_exception_references(shift.id, now)
        shift.refresh_from_db()
        self.assertEqual(shift.revision, 0)
        self.assertEqual(shift.state_json, envelope)


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
