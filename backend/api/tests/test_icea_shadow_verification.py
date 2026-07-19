import io
import json
import os
from unittest.mock import patch

import httpx
from django.core.management import call_command
from django.test import SimpleTestCase

from backend.api.icea_shadow_verification import (
    FAIL,
    NOT_VERIFIED,
    PASS,
    _load_synthetic_fixture,
    _synthetic_fixture_reason,
    verify_synthetic_icea_shadow_bridge,
)

MODEL_ID = "11111111-1111-4111-8111-111111111111"
BRIDGE_ENV = {
    "ENABLE_ICEA_BRIDGE": "true",
    "ENABLE_ICEA_IMMEDIATE_SCORING": "true",
    "ICEA_BRIDGE_MODEL_ID": MODEL_ID,
    "ICEA_API_BASE_URL": "http://127.0.0.1:8001",
    "ICEA_API_BEARER_TOKEN": "synthetic-test-token",
    "ICEA_BRIDGE_SCORE_PATH": "/api/v1/icea-plus/score/",
}


def shadow_response(*, status: str = "shadow_only") -> dict:
    return {
        "formula_version": "icea-plus-shadow-v1",
        "shadow_mode": True,
        "non_individual_use": True,
        "intended_use": "shadow_aggregate_research",
        "score_summary": None,
        "score_summary_redacted": True,
        "summary_redacted": True,
        "redaction_reason": "non_individual_shadow_mode",
        "summary": {
            "rows_requested": 1,
            "rows_scored": 1 if status == "shadow_only" else 0,
            "summary_redacted": True,
        },
        "results": [
            {
                "row_id": "window:enc-fixture-icu-1",
                "status": status,
                "score": None,
                "raw_score": None,
                "score_suppressed": True,
                "derived_values_redacted": True,
                "suppression_reason": "individual_shadow_score_and_derivatives_are_not_exportable",
                "shadow_mode": True,
                "non_individual_use": True,
                "intended_use": "shadow_aggregate_research",
                "flags": {
                    "shadow_mode": True,
                    "non_individual_use": True,
                },
                "warnings": [],
            }
        ],
    }


class IceaShadowVerificationTests(SimpleTestCase):
    def test_fixed_fixture_is_explicitly_synthetic_and_valid_for_the_builder(self):
        bundle = _load_synthetic_fixture()

        synthetic, reason = _synthetic_fixture_reason(bundle)

        self.assertTrue(synthetic, reason)
        self.assertEqual(bundle["resourceType"], "Bundle")
        self.assertEqual(bundle["type"], "transaction")

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_pass_builds_real_feature_contract_and_confirms_shadow_safety(self, mock_request):
        mock_request.return_value = httpx.Response(200, json=shadow_response())

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], PASS)
        self.assertTrue(result["fixture"]["synthetic"])
        self.assertTrue(result["transport"]["reached_icea"])
        self.assertEqual(result["transport"]["http_status"], 200)
        self.assertEqual(result["contract"]["contract_version"], "handover-icea-feature-v1")
        self.assertEqual(result["contract"]["source_repo"], "Luis195f/HANDOVER")
        self.assertTrue(result["contract"]["shadow_mode"])
        self.assertTrue(result["contract"]["non_individual_use"])
        self.assertTrue(all(result["governance"].values()))
        self.assertEqual(result["idempotency"]["handover_retry"], PASS)
        self.assertEqual(result["idempotency"]["receiver_replay"], NOT_VERIFIED)

        request_kwargs = mock_request.call_args.kwargs
        posted = request_kwargs["json"]
        self.assertEqual(posted["contract_version"], "handover-icea-feature-v1")
        self.assertEqual(posted["source_repo"], "Luis195f/HANDOVER")
        self.assertTrue(posted["shadow_mode"])
        self.assertTrue(posted["non_individual_use"])
        self.assertFalse(posted["from_db"])
        self.assertEqual(posted["rows"][0]["contract_version"], "handover-icea-feature-v1")
        self.assertEqual(posted["rows"][0]["source_repo"], "Luis195f/HANDOVER")
        self.assertTrue(posted["rows"][0]["shadow_mode"])
        self.assertTrue(posted["rows"][0]["non_individual_use"])
        self.assertTrue(request_kwargs["headers"]["Idempotency-Key"])
        self.assertEqual(request_kwargs["headers"]["Authorization"], "Bearer synthetic-test-token")

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_contract_mismatch_is_fail_with_explainable_reason(self, mock_request):
        mock_request.return_value = httpx.Response(200, json=shadow_response(status="contract_mismatch"))

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], FAIL)
        failed_checks = {check["name"]: check for check in result["checks"] if check["status"] == FAIL}
        self.assertIn("receiver_accepted_feature_contract", failed_checks)
        self.assertIn("contract_mismatch", failed_checks["receiver_accepted_feature_contract"]["reason"])

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_insufficient_evidence_is_analytic_not_verified_not_contract_failure(self, mock_request):
        mock_request.return_value = httpx.Response(200, json=shadow_response(status="insufficient_evidence"))

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], NOT_VERIFIED)
        contract_check = next(
            check for check in result["checks"] if check["name"] == "receiver_accepted_feature_contract"
        )
        analytic_check = next(
            check for check in result["checks"] if check["name"] == "receiver_shadow_result_status"
        )
        self.assertEqual(contract_check["status"], PASS)
        self.assertEqual(analytic_check["status"], NOT_VERIFIED)
        self.assertIn("valid analytic non-scoring result", analytic_check["reason"])
        self.assertFalse(any(check["status"] == FAIL for check in result["checks"]))

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_recognized_individual_score_aliases_are_fail(self, mock_request):
        cases = (
            ("score_summary", "root", {"score": 72.4}),
            ("scoreSummary", "root", {"score": 72.4}),
            ("score", "result", 72.4),
            ("raw_score", "result", 0.724),
            ("rawScore", "result", 0.724),
            ("riskScore", "result", 72.4),
            ("value", "result", 72.4),
        )

        for score_key, location, numeric_value in cases:
            with self.subTest(score_key=score_key, location=location):
                unsafe_body = shadow_response()
                target = unsafe_body if location == "root" else unsafe_body["results"][0]
                target[score_key] = numeric_value
                mock_request.return_value = httpx.Response(200, json=unsafe_body)

                with patch.dict(os.environ, BRIDGE_ENV, clear=False):
                    result = verify_synthetic_icea_shadow_bridge()

                self.assertEqual(result["status"], FAIL)
                self.assertFalse(result["governance"]["no_individual_result"])
                self.assertIn(
                    "no_individual_result",
                    {check["name"] for check in result["checks"] if check["status"] == FAIL},
                )

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_numeric_value_outside_score_context_is_not_rejected(self, mock_request):
        safe_body = shadow_response()
        safe_body["metadata"] = {"value": 1}
        mock_request.return_value = httpx.Response(200, json=safe_body)

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], PASS)
        self.assertTrue(result["governance"]["no_individual_result"])

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_forbidden_non_individual_response_fields_are_fail(self, mock_request):
        cases = (
            ("rank", "no_individual_ranking"),
            ("ranking", "no_individual_ranking"),
            ("employee_score", "no_employment_score"),
            ("employment_score", "no_employment_score"),
            ("labor_score", "no_employment_score"),
            ("workforce_score", "no_employment_score"),
            ("writeback", "no_individual_clinical_writeback"),
            ("clinical_writeback", "no_individual_clinical_writeback"),
            ("clinical_action", "no_automatic_clinical_action"),
            ("automatic_action", "no_automatic_clinical_action"),
            ("automatic_clinical_action", "no_automatic_clinical_action"),
        )

        for forbidden_key, governance_check in cases:
            with self.subTest(forbidden_key=forbidden_key):
                unsafe_body = shadow_response()
                unsafe_body["results"][0][forbidden_key] = {"synthetic": True}
                mock_request.return_value = httpx.Response(200, json=unsafe_body)

                with patch.dict(os.environ, BRIDGE_ENV, clear=False):
                    result = verify_synthetic_icea_shadow_bridge()

                self.assertEqual(result["status"], FAIL)
                self.assertFalse(result["governance"][governance_check])
                self.assertIn(
                    governance_check,
                    {check["name"] for check in result["checks"] if check["status"] == FAIL},
                )

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_network_error_is_controlled_not_verified(self, mock_request):
        mock_request.side_effect = httpx.ConnectError("synthetic connection failure")

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], NOT_VERIFIED)
        self.assertFalse(result["transport"]["reached_icea"])
        transport = next(check for check in result["checks"] if check["name"] == "icea_transport")
        self.assertEqual(transport["status"], NOT_VERIFIED)
        self.assertIn("could not reach", transport["reason"])

    @patch("backend.api.icea_bridge_service.httpx.request")
    def test_timeout_is_controlled_not_verified(self, mock_request):
        mock_request.side_effect = httpx.ReadTimeout("synthetic timeout")

        with patch.dict(os.environ, BRIDGE_ENV, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], NOT_VERIFIED)
        transport = next(check for check in result["checks"] if check["name"] == "icea_transport")
        self.assertEqual(transport["status"], NOT_VERIFIED)
        self.assertIn("timed out", transport["reason"])

    @patch("backend.api.icea_shadow_verification.IceaBridgeRemoteService.submit_score")
    def test_non_local_endpoint_requires_explicit_test_confirmation(self, mock_submit):
        remote_env = {
            **BRIDGE_ENV,
            "ICEA_API_BASE_URL": "https://icea-test.example",
        }

        with patch.dict(os.environ, remote_env, clear=False):
            result = verify_synthetic_icea_shadow_bridge()

        self.assertEqual(result["status"], NOT_VERIFIED)
        self.assertFalse(result["transport"]["reached_icea"])
        mock_submit.assert_not_called()

    @patch(
        "backend.api.management.commands.verify_icea_shadow_bridge.verify_synthetic_icea_shadow_bridge"
    )
    def test_management_command_emits_structured_json(self, mock_verify):
        mock_verify.return_value = {
            "verification": "test",
            "status": PASS,
            "checks": [],
        }
        stdout = io.StringIO()

        call_command("verify_icea_shadow_bridge", compact=True, stdout=stdout)

        output = json.loads(stdout.getvalue())
        self.assertEqual(output["status"], PASS)
        mock_verify.assert_called_once()
