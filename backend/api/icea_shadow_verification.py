from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from django.utils import timezone

from backend.api.icea_bridge_service import (
    FEATURE_CONTRACT_VERSION,
    FEATURE_SOURCE_REPO,
    IceaBridgeRemoteService,
    NON_SCORING_CONTRACT_FAILURE_REMOTE_STATUSES,
    NON_SCORING_REMOTE_STATUSES,
    build_icea_bridge_idempotency_key,
    build_icea_plus_score_request,
    load_icea_bridge_settings,
    remote_payload_has_individual_score_material,
    score_configuration_error_code,
)
from backend.api.icea_payload_mapper import build_icea_bridge_payload, compute_payload_hash
from backend.api.icea_pipeline import (
    IceaPipelineConfigurationError,
    IceaPipelineHTTPStatusError,
    IceaPipelineService,
    IceaPipelineTransportError,
    load_icea_pipeline_settings,
)
from backend.api.models import IceaBridgeRequest

VERIFICATION_NAME = "HANDOVER -> ICEA Integration Readiness & Shadow Bridge Verification"
DEFAULT_REQUEST_ID = "build-week-shadow-verification-v1"
SYNTHETIC_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "fhir"
    / "uci-adulto-contextual-bundle.json"
)
EXPECTED_INTENDED_USE = "shadow_aggregate_research"
PASS = "PASS"
FAIL = "FAIL"
NOT_VERIFIED = "NOT_VERIFIED"

ANALYTIC_NON_SCORING_STATUSES = frozenset(
    NON_SCORING_REMOTE_STATUSES - NON_SCORING_CONTRACT_FAILURE_REMOTE_STATUSES
)
FORBIDDEN_RESPONSE_KEYS = frozenset(
    {
        "rank",
        "ranking",
        "employee_score",
        "employment_score",
        "labor_score",
        "workforce_score",
        "writeback",
        "clinical_writeback",
        "clinical_action",
        "automatic_action",
        "automatic_clinical_action",
    }
)


def _check(name: str, status: str, reason: str) -> dict[str, str]:
    return {"name": name, "status": status, "reason": reason}


def _base_result(*, request_id: str) -> dict[str, Any]:
    return {
        "verification": VERIFICATION_NAME,
        "status": NOT_VERIFIED,
        "fixture": {
            "path": "tests/fixtures/fhir/uci-adulto-contextual-bundle.json",
            "synthetic": False,
        },
        "contract": {
            "contract_version": FEATURE_CONTRACT_VERSION,
            "source_repo": FEATURE_SOURCE_REPO,
            "shadow_mode": True,
            "non_individual_use": True,
        },
        "transport": {
            "request_id": request_id,
            "reached_icea": False,
            "http_status": None,
            "auth_mode": None,
        },
        "idempotency": {
            "handover_retry": NOT_VERIFIED,
            "receiver_replay": NOT_VERIFIED,
            "receiver_replay_reason": (
                "The current ICEA score receiver does not expose a replay guarantee or idempotency receipt; "
                "the verifier does not claim receiver-side deduplication."
            ),
        },
        "governance": {
            "no_individual_result": False,
            "no_individual_ranking": False,
            "no_employment_score": False,
            "no_individual_clinical_writeback": False,
            "no_automatic_clinical_action": False,
        },
        "checks": [],
        "reasons": [],
    }


def _load_synthetic_fixture() -> dict[str, Any]:
    with SYNTHETIC_FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("synthetic_fixture_not_object")
    return payload


def _resource_rows(bundle: dict[str, Any], resource_type: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for entry in bundle.get("entry") or []:
        resource = entry.get("resource") if isinstance(entry, dict) else None
        if isinstance(resource, dict) and resource.get("resourceType") == resource_type:
            rows.append(resource)
    return rows


def _synthetic_fixture_reason(bundle: dict[str, Any]) -> tuple[bool, str]:
    if bundle.get("resourceType") != "Bundle" or bundle.get("type") != "transaction":
        return False, "The fixed fixture is not a FHIR transaction Bundle."

    patients = _resource_rows(bundle, "Patient")
    practitioners = _resource_rows(bundle, "Practitioner")
    if len(patients) != 1 or not practitioners:
        return False, "The fixed fixture must contain one synthetic Patient and at least one synthetic Practitioner."

    patient_ids = [str(patient.get("id") or "").strip().lower() for patient in patients]
    practitioner_ids = [str(practitioner.get("id") or "").strip().lower() for practitioner in practitioners]
    if not all(value.startswith("fixture-") for value in patient_ids):
        return False, "The fixed fixture Patient identifier is not explicitly fixture-scoped."
    if not all("fixture" in value for value in practitioner_ids):
        return False, "The fixed fixture Practitioner identifier is not explicitly fixture-scoped."

    patient_names = [patient.get("name") for patient in patients if patient.get("name")]
    if patient_names:
        return False, "The fixed synthetic fixture must not contain a Patient name."

    return True, "The fixed FHIR fixture is transaction-shaped and uses only explicit fixture identities."


def _transient_bridge_request(
    *,
    bridge_payload: dict[str, Any],
    request_id: str,
    scoring_mode: str,
) -> IceaBridgeRequest:
    payload_hash = compute_payload_hash(bridge_payload)
    identity = bridge_payload.get("identity") if isinstance(bridge_payload.get("identity"), dict) else {}
    context = bridge_payload.get("context") if isinstance(bridge_payload.get("context"), dict) else {}
    now = timezone.now()
    bridge_request = IceaBridgeRequest(
        bridge_request_id=f"{request_id}:{scoring_mode}",
        request_id=request_id,
        bundle_id=str(identity.get("bundleId") or request_id),
        patient_id=str(identity.get("patientId") or "unknown"),
        unit_id=str(context.get("unitId") or "unknown"),
        encounter_id=str(identity.get("encounterId") or ""),
        composition_id=str(identity.get("compositionId") or ""),
        episode_id=str(identity.get("episodeId") or identity.get("bundleId") or request_id),
        shift=str(context.get("shift") or ""),
        scoring_mode=scoring_mode,
        idempotency_key=build_icea_bridge_idempotency_key(request_id, scoring_mode, payload_hash),
        payload_hash=payload_hash,
        payload_json=bridge_payload,
        status=IceaBridgeRequest.STATUS_QUEUED,
        contract_version=str(bridge_payload.get("contractVersion") or ""),
    )
    bridge_request.created_at = now
    bridge_request.updated_at = now
    return bridge_request


def _all_nested_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            keys.add(str(key).strip().lower())
            keys.update(_all_nested_keys(nested))
    elif isinstance(value, list):
        for nested in value:
            keys.update(_all_nested_keys(nested))
    return keys


def _is_local_endpoint(base_url: str) -> bool:
    return (urlparse(base_url).hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}


def _validate_remote_response(body: Any) -> tuple[list[dict[str, str]], dict[str, bool]]:
    checks: list[dict[str, str]] = []
    governance = {
        "no_individual_result": False,
        "no_individual_ranking": False,
        "no_employment_score": False,
        "no_individual_clinical_writeback": False,
        "no_automatic_clinical_action": False,
    }
    if not isinstance(body, dict):
        checks.append(_check("remote_response_json", FAIL, "ICEA did not return a JSON object."))
        return checks, governance

    checks.append(_check("remote_response_json", PASS, "ICEA returned a JSON object."))
    remote_governance = (
        body.get("shadow_mode") is True
        and body.get("non_individual_use") is True
        and body.get("intended_use") == EXPECTED_INTENDED_USE
    )
    checks.append(
        _check(
            "remote_shadow_governance",
            PASS if remote_governance else FAIL,
            (
                "ICEA confirmed shadow aggregate research and non-individual use."
                if remote_governance
                else "ICEA did not confirm the required shadow/non-individual governance fields."
            ),
        )
    )

    results = body.get("results")
    valid_results = isinstance(results, list) and bool(results) and all(isinstance(row, dict) for row in results)
    checks.append(
        _check(
            "remote_results_shape",
            PASS if valid_results else FAIL,
            "ICEA returned at least one structured result." if valid_results else "ICEA returned no structured result rows.",
        )
    )
    if not valid_results:
        return checks, governance

    rows = [row for row in results if isinstance(row, dict)]
    row_governance = all(
        row.get("shadow_mode") is True
        and row.get("non_individual_use") is True
        and row.get("intended_use") == EXPECTED_INTENDED_USE
        for row in rows
    )
    checks.append(
        _check(
            "remote_row_shadow_governance",
            PASS if row_governance else FAIL,
            (
                "Every ICEA result row confirmed shadow aggregate research and non-individual use."
                if row_governance
                else "At least one ICEA result row did not confirm shadow/non-individual governance."
            ),
        )
    )
    statuses = {str(row.get("status") or "").strip().lower() for row in rows}
    contract_failures = statuses & NON_SCORING_CONTRACT_FAILURE_REMOTE_STATUSES
    analytic_non_scoring = statuses & ANALYTIC_NON_SCORING_STATUSES
    if contract_failures:
        contract_status = FAIL
        contract_reason = (
            "ICEA reported contractual incompatibility: "
            f"{', '.join(sorted(contract_failures))}."
        )
    elif statuses and statuses <= (ANALYTIC_NON_SCORING_STATUSES | {"shadow_only"}):
        contract_status = PASS
        contract_reason = "ICEA accepted the feature contract."
    else:
        contract_status = FAIL
        contract_reason = (
            f"ICEA returned unexpected row status(es): {', '.join(sorted(statuses)) or 'missing'}."
        )
    checks.append(
        _check(
            "receiver_accepted_feature_contract",
            contract_status,
            contract_reason,
        )
    )
    if contract_status == PASS:
        checks.append(
            _check(
                "receiver_shadow_result_status",
                NOT_VERIFIED if analytic_non_scoring else PASS,
                (
                    "ICEA returned a valid analytic non-scoring result: "
                    f"{', '.join(sorted(analytic_non_scoring))}; the shadow result remains inconclusive."
                    if analytic_non_scoring
                    else "ICEA returned only conclusive shadow_only rows."
                ),
            )
        )

    individual_score_material = any(
        remote_payload_has_individual_score_material(body, row)
        for row in rows
    )
    individual_result_redacted = (
        not individual_score_material
        and body.get("score_summary") is None
        and body.get("score_summary_redacted") is True
        and body.get("summary_redacted") is True
        and all(
            row.get("score") is None
            and row.get("raw_score") is None
            and row.get("score_suppressed") is True
            and row.get("derived_values_redacted") is True
            and not any(key in row for key in ("components", "confidence", "legacy_icea", "aggregation"))
            for row in rows
        )
    )
    governance["no_individual_result"] = individual_result_redacted
    checks.append(
        _check(
            "no_individual_result",
            PASS if individual_result_redacted else FAIL,
            (
                "ICEA returned no numeric individual score or derived individual breakdown."
                if individual_result_redacted
                else "ICEA response exposed or failed to explicitly redact individual score material."
            ),
        )
    )

    nested_keys = _all_nested_keys(body)
    present_forbidden = nested_keys & FORBIDDEN_RESPONSE_KEYS
    no_ranking = not bool(present_forbidden & {"rank", "ranking"})
    no_employment_score = not bool(
        present_forbidden & {"employee_score", "employment_score", "labor_score", "workforce_score"}
    )
    no_writeback = not bool(present_forbidden & {"writeback", "clinical_writeback"})
    no_automatic_action = not bool(
        present_forbidden & {"clinical_action", "automatic_action", "automatic_clinical_action"}
    )
    governance.update(
        {
            "no_individual_ranking": no_ranking,
            "no_employment_score": no_employment_score,
            "no_individual_clinical_writeback": no_writeback,
            "no_automatic_clinical_action": no_automatic_action,
        }
    )
    for name, passed, reason in (
        ("no_individual_ranking", no_ranking, "ICEA response contains no individual ranking field."),
        ("no_employment_score", no_employment_score, "ICEA response contains no employment or labor score field."),
        ("no_individual_clinical_writeback", no_writeback, "ICEA response contains no clinical writeback field."),
        ("no_automatic_clinical_action", no_automatic_action, "ICEA response contains no automatic clinical action field."),
    ):
        checks.append(
            _check(
                name,
                PASS if passed else FAIL,
                reason if passed else f"ICEA response included a forbidden field for {name}.",
            )
        )
    return checks, governance


def verify_synthetic_icea_shadow_bridge(
    *,
    request_id: str = DEFAULT_REQUEST_ID,
    allow_remote_test_endpoint: bool = False,
) -> dict[str, Any]:
    result = _base_result(request_id=request_id)
    checks: list[dict[str, str]] = result["checks"]

    try:
        bundle = _load_synthetic_fixture()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        result["status"] = FAIL
        reason = f"Synthetic fixture could not be loaded: {exc.__class__.__name__}."
        checks.append(_check("synthetic_fixture", FAIL, reason))
        result["reasons"].append(reason)
        return result

    synthetic, synthetic_reason = _synthetic_fixture_reason(bundle)
    result["fixture"]["synthetic"] = synthetic
    checks.append(_check("synthetic_fixture", PASS if synthetic else FAIL, synthetic_reason))
    if not synthetic:
        result["status"] = FAIL
        result["reasons"].append(synthetic_reason)
        return result

    bridge_settings = load_icea_bridge_settings()
    configuration_error = score_configuration_error_code(
        IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        settings_obj=bridge_settings,
    )
    if configuration_error is not None:
        reason = f"HANDOVER bridge configuration is incomplete: {configuration_error}."
        checks.append(_check("bridge_configuration", NOT_VERIFIED, reason))
        result["reasons"].append(reason)
        return result
    checks.append(_check("bridge_configuration", PASS, "HANDOVER bridge and immediate shadow scoring are enabled."))

    pipeline_settings = load_icea_pipeline_settings()
    if not pipeline_settings.enabled or pipeline_settings.validation_errors:
        detail = pipeline_settings.primary_error or "icea_pipeline_not_configured"
        reason = f"ICEA service authentication/endpoint configuration is incomplete: {detail}."
        checks.append(_check("service_auth_configuration", NOT_VERIFIED, reason))
        result["reasons"].append(reason)
        return result

    endpoint_is_local = _is_local_endpoint(pipeline_settings.base_url)
    if not endpoint_is_local and not allow_remote_test_endpoint:
        reason = "A non-local ICEA endpoint requires --allow-remote-test-endpoint."
        checks.append(_check("explicit_test_endpoint", NOT_VERIFIED, reason))
        result["reasons"].append(reason)
        return result
    checks.append(
        _check(
            "explicit_test_endpoint",
            PASS,
            "ICEA endpoint is local." if endpoint_is_local else "Remote test endpoint was explicitly confirmed.",
        )
    )
    result["transport"]["auth_mode"] = (
        "bearer" if pipeline_settings.bearer_token else "client_credentials"
    )

    try:
        bridge_payload = build_icea_bridge_payload(
            bundle,
            request_id=request_id,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            unit_id="icu-a",
        )
        bridge_request = _transient_bridge_request(
            bridge_payload=bridge_payload,
            request_id=request_id,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        retry_bridge_request = _transient_bridge_request(
            bridge_payload=bridge_payload,
            request_id=request_id,
            scoring_mode=IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
        )
        score_request = build_icea_plus_score_request(bridge_request, bridge_settings)
        retry_request = build_icea_plus_score_request(retry_bridge_request, bridge_settings)
    except (IceaPipelineConfigurationError, TypeError, ValueError) as exc:
        reason = f"HANDOVER could not build the feature contract: {exc.__class__.__name__}."
        checks.append(_check("feature_contract_build", FAIL, reason))
        result["status"] = FAIL
        result["reasons"].append(reason)
        return result

    row = score_request["rows"][0]
    contract_valid = (
        score_request.get("contract_version") == FEATURE_CONTRACT_VERSION
        and score_request.get("source_repo") == FEATURE_SOURCE_REPO
        and score_request.get("shadow_mode") is True
        and score_request.get("non_individual_use") is True
        and row.get("contract_version") == FEATURE_CONTRACT_VERSION
        and row.get("source_repo") == FEATURE_SOURCE_REPO
        and row.get("shadow_mode") is True
        and row.get("non_individual_use") is True
        and score_request.get("from_db") is False
    )
    checks.append(
        _check(
            "feature_contract_build",
            PASS if contract_valid else FAIL,
            (
                "HANDOVER built the required feature contract and governance fields."
                if contract_valid
                else "HANDOVER feature contract or governance fields did not match the required values."
            ),
        )
    )
    if not contract_valid:
        result["status"] = FAIL
        result["reasons"].append("Local feature contract mismatch.")
        return result

    retry_key_stable = (
        score_request == retry_request
        and bool(bridge_request.idempotency_key)
        and bridge_request.idempotency_key == retry_bridge_request.idempotency_key
    )
    result["idempotency"]["handover_retry"] = PASS if retry_key_stable else FAIL
    checks.append(
        _check(
            "handover_retry_idempotency",
            PASS if retry_key_stable else FAIL,
            (
                "The same transient bridge request rebuilds the same body and reuses one Idempotency-Key."
                if retry_key_stable
                else "HANDOVER did not preserve the request body/idempotency key for a retry."
            ),
        )
    )
    if not retry_key_stable:
        result["status"] = FAIL
        result["reasons"].append("HANDOVER retry idempotency check failed.")
        return result

    service = IceaBridgeRemoteService(
        settings_obj=bridge_settings,
        pipeline_service=IceaPipelineService(settings_obj=pipeline_settings),
    )
    try:
        remote_response = service.submit_score(bridge_request)
    except IceaPipelineTransportError as exc:
        timeout = "timeout" in exc.detail.lower()
        reason = (
            "ICEA verification timed out; no contract verdict was inferred."
            if timeout
            else "ICEA verification could not reach the configured endpoint; no contract verdict was inferred."
        )
        checks.append(_check("icea_transport", NOT_VERIFIED, reason))
        result["reasons"].append(reason)
        return result
    except IceaPipelineHTTPStatusError as exc:
        status = FAIL if exc.http_status in {400, 409, 415, 422} else NOT_VERIFIED
        reason = (
            f"ICEA rejected the verification request with HTTP {exc.http_status}."
            if status == FAIL
            else f"ICEA endpoint returned HTTP {exc.http_status}; integration could not be verified."
        )
        checks.append(_check("icea_transport", status, reason))
        result["status"] = status
        result["transport"]["http_status"] = exc.http_status
        result["reasons"].append(reason)
        return result
    except IceaPipelineConfigurationError as exc:
        reason = f"ICEA service authentication could not be completed: {exc.detail}."
        checks.append(_check("icea_transport", NOT_VERIFIED, reason))
        result["reasons"].append(reason)
        return result

    result["transport"]["reached_icea"] = True
    result["transport"]["http_status"] = remote_response.status_code
    checks.append(_check("icea_transport", PASS, f"ICEA responded with HTTP {remote_response.status_code}."))

    response_checks, governance = _validate_remote_response(remote_response.body_json)
    checks.extend(response_checks)
    result["governance"] = governance
    failed = [check for check in checks if check["status"] == FAIL]
    if failed:
        result["status"] = FAIL
        result["reasons"] = [check["reason"] for check in failed]
        return result

    inconclusive = [check for check in checks if check["status"] == NOT_VERIFIED]
    if inconclusive:
        result["status"] = NOT_VERIFIED
        result["reasons"] = [check["reason"] for check in inconclusive]
        return result

    result["status"] = PASS
    result["reasons"] = [
        "HANDOVER built and delivered the required synthetic shadow feature contract.",
        "ICEA confirmed non-individual shadow governance and redacted individual score material.",
        result["idempotency"]["receiver_replay_reason"],
    ]
    return result
