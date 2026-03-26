#!/usr/bin/env python
import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
TMP_ROOT = REPO_ROOT / "tmp"
DANGEROUS_DB_OVERRIDE_ENV = "PERF_SMOKE_ALLOW_NON_EPHEMERAL_DB"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
os.environ.setdefault("PYTEST_CURRENT_TEST", "perf_smoke")
os.environ.setdefault("FHIR_BASE", "https://example.invalid/fhir")

_EPHEMERAL_DB_DIR: tempfile.TemporaryDirectory[str] | None = None


def is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def configure_perf_smoke_database() -> dict[str, object]:
    global _EPHEMERAL_DB_DIR

    override_enabled = is_truthy(os.environ.get(DANGEROUS_DB_OVERRIDE_ENV))
    if override_enabled:
        return {
            "engine": os.environ.get("DJANGO_DB_ENGINE", "django.db.backends.sqlite3"),
            "name": str(os.environ.get("DJANGO_DB_NAME", REPO_ROOT / "db.sqlite3")),
            "ephemeral": False,
            "overrideEnabled": True,
            "note": (
                f"{DANGEROUS_DB_OVERRIDE_ENV}=true bypasses the default ephemeral SQLite isolation. "
                "Use only for deliberate local diagnostics against a non-ephemeral database."
            ),
        }

    TMP_ROOT.mkdir(exist_ok=True)
    _EPHEMERAL_DB_DIR = tempfile.TemporaryDirectory(prefix="handover-perf-smoke-", dir=TMP_ROOT)
    db_path = Path(_EPHEMERAL_DB_DIR.name) / "perf-smoke.sqlite3"
    os.environ["DJANGO_DB_ENGINE"] = "django.db.backends.sqlite3"
    os.environ["DJANGO_DB_NAME"] = str(db_path)
    return {
        "engine": "django.db.backends.sqlite3",
        "name": str(db_path),
        "ephemeral": True,
        "overrideEnabled": False,
        "note": (
            "Default isolated SQLite database for synthetic perf smoke. "
            "Existing DJANGO_DB_* values are ignored unless the dangerous override is enabled."
        ),
    }


PERF_SMOKE_DATABASE = configure_perf_smoke_database()

import django

django.setup()

from django.core.management import call_command
from django.db import connections
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
from backend.api.tests.icea_test_utils import authenticate_api_client, build_fhir_response, build_icea_bundle
from backend.audit.models import AuditEvent


def cleanup_ephemeral_database() -> None:
    connections.close_all()
    if _EPHEMERAL_DB_DIR is not None:
        _EPHEMERAL_DB_DIR.cleanup()


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * pct
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize(label: str, durations_ms: list[float], note: str) -> dict:
    return {
        "scenario": label,
        "iterations": len(durations_ms),
        "minMs": round(min(durations_ms), 2),
        "avgMs": round(statistics.mean(durations_ms), 2),
        "p95Ms": round(percentile(durations_ms, 0.95), 2),
        "maxMs": round(max(durations_ms), 2),
        "note": note,
    }


def seed_summary_data(unit_id: str) -> None:
    now = timezone.now()
    bundle_id = f"perf-dashboard-{unit_id}"
    request_id = f"perf-dashboard-request-{unit_id}"
    patient_id = f"perf-patient-{unit_id}"
    HandoverBundleRecord.objects.filter(bundle_id=bundle_id).delete()
    HandoverBundleRecord.objects.create(
        bundle_id=bundle_id,
        patient_id=patient_id,
        unit_id=unit_id,
        request_id=request_id,
        bundle_json=build_icea_bundle(bundle_id=bundle_id, patient_id=patient_id, unit_id=unit_id),
        expires_at=HandoverBundleRecord.default_expiry(now=now),
    )
    IceaPipelineSnapshot.objects.update_or_create(
        request_id=request_id,
        defaults={
            "bundle_id": bundle_id,
            "patient_id": patient_id,
            "unit_id": unit_id,
            "visible_status": "retry",
            "last_stage": "ingest",
            "stage_statuses": {"ingest": {"status": "retry"}},
            "last_error": "synthetic_timeout",
        },
    )
    IceaOutboundEvent.objects.update_or_create(
        request_id=request_id,
        defaults={
            "idempotency_key": request_id,
            "bundle_id": bundle_id,
            "patient_id": patient_id,
            "unit_id": unit_id,
            "payload_json": {"bundleId": bundle_id},
            "status": IceaOutboundEvent.STATUS_RETRY,
            "last_error": "synthetic_timeout",
        },
    )
    IceaBridgeRequest.objects.update_or_create(
        bridge_request_id=f"{request_id}:immediate_provisional",
        defaults={
            "request_id": request_id,
            "bundle_id": bundle_id,
            "patient_id": patient_id,
            "unit_id": unit_id,
            "scoring_mode": IceaBridgeRequest.SCORING_MODE_IMMEDIATE,
            "idempotency_key": f"{request_id}:hash",
            "payload_hash": "abcd" * 16,
            "payload_json": {"contractVersion": "handover-icea-bridge-v1"},
            "status": IceaBridgeRequest.STATUS_STALE,
            "insufficient_evidence": True,
        },
    )
    IceaPipelineEvent.objects.update_or_create(
        request_id=request_id,
        stage="dashboard-summary",
        defaults={
            "bundle_id": bundle_id,
            "patient_id": patient_id,
            "unit_id": unit_id,
            "action": "refresh-dashboard-summary",
            "status": "succeeded",
            "source": "perf-smoke",
        },
    )
    AuditEvent.objects.create(
        event_type="handover_timing",
        action="create",
        status="success",
        meta={"timing": {"sectionId": "sbar", "durationMs": 1500, "unitId": unit_id}},
    )


def measure(iterations: int, fn) -> list[float]:
    values: list[float] = []
    for _ in range(iterations):
        started = time.perf_counter()
        fn()
        values.append((time.perf_counter() - started) * 1000)
    return values


def run_fhir_transaction(iterations: int) -> dict:
    client = APIClient()
    authenticate_api_client(client, roles=["nurse"], scopes=["fhir:transaction", "handover:write"])
    counter = {"value": 0}

    def once() -> None:
        counter["value"] += 1
        iteration = counter["value"]
        bundle = build_icea_bundle(
            bundle_id=f"perf-fhir-{iteration}",
            patient_id=f"perf-patient-{iteration}",
            unit_id="icu-adulto",
        )
        with (
            patch("backend.api.views._ensure_bundle_signature", return_value=None),
            patch("backend.api.views._create_audit_event_for_transaction", return_value=None),
            patch("backend.api.views._post_transaction_to_fhir", return_value=build_fhir_response(201)),
        ):
            response = client.post(
                reverse("fhir-transaction"),
                data=bundle,
                format="json",
                HTTP_X_UNIT_ID="icu-adulto",
            )
        if response.status_code != 201:
            raise RuntimeError(f"Unexpected FHIR transaction status: {response.status_code}")

    durations_ms = measure(iterations, once)
    return summarize(
        "fhir_transaction_synthetic",
        durations_ms,
        "Synthetic Django path with mocked upstream FHIR response; local side effects stay enabled.",
    )


def run_dashboard_summary(iterations: int) -> dict:
    client = APIClient()
    authenticate_api_client(client, roles=["supervisor"], scopes=["handover:write"])
    seed_summary_data("icu-adulto")

    def once() -> None:
        response = client.get(reverse("icea-dashboard-summary"), {"unitId": "icu-adulto"})
        if response.status_code != 200:
            raise RuntimeError(f"Unexpected dashboard-summary status: {response.status_code}")

    durations_ms = measure(iterations, once)
    return summarize(
        "icea_dashboard_summary",
        durations_ms,
        "Aggregated dashboard load over synthetic local records; no upstream ICEA call is made.",
    )


def run_ops_summary(iterations: int) -> dict:
    client = APIClient()
    authenticate_api_client(client, roles=["supervisor"], scopes=["handover:write"])
    seed_summary_data("icu-adulto")

    def once() -> None:
        response = client.get(reverse("icea-ops-summary"))
        if response.status_code != 200:
            raise RuntimeError(f"Unexpected ops-summary status: {response.status_code}")

    durations_ms = measure(iterations, once)
    return summarize(
        "icea_ops_summary",
        durations_ms,
        "Operational summary over synthetic local records with PHI-safe aggregates only.",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthetic local performance smoke for HANDOVER preproduction rehearsal.")
    parser.add_argument("--iterations", type=int, default=3, help="Number of iterations per measured scenario.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()

    try:
        call_command("migrate", interactive=False, verbosity=0)

        results = {
            "generatedAt": timezone.now().isoformat(),
            "iterations": args.iterations,
            "database": PERF_SMOKE_DATABASE,
            "measured": [
                run_fhir_transaction(args.iterations),
                run_dashboard_summary(args.iterations),
                run_ops_summary(args.iterations),
            ],
            "scriptedOnly": [
                {
                    "scenario": "offline_queue_sync",
                    "command": "pnpm exec vitest run tests/queue/offline-queue.spec.ts src/lib/__tests__/sync.offline.spec.ts",
                    "note": "The repo exposes a real queue/sync smoke but not an isolated latency probe for replay timing.",
                }
            ],
        }

        if args.json:
            print(json.dumps(results, indent=2))
            return

        print("HANDOVER synthetic perf smoke")
        print(f"generatedAt: {results['generatedAt']}")
        print(f"iterations: {args.iterations}")
        print(
            "database: {engine} :: {name}".format(
                engine=PERF_SMOKE_DATABASE["engine"],
                name=PERF_SMOKE_DATABASE["name"],
            )
        )
        print(f"databaseNote: {PERF_SMOKE_DATABASE['note']}")
        if PERF_SMOKE_DATABASE["overrideEnabled"]:
            print(f"databaseSafetyOverride: {DANGEROUS_DB_OVERRIDE_ENV}=true")
        for item in results["measured"]:
            print(
                "- {scenario}: min={minMs}ms avg={avgMs}ms p95={p95Ms}ms max={maxMs}ms".format(
                    **item
                )
            )
            print(f"  note: {item['note']}")
        for item in results["scriptedOnly"]:
            print(f"- {item['scenario']}: scripted only via `{item['command']}`")
            print(f"  note: {item['note']}")
    finally:
        cleanup_ephemeral_database()


if __name__ == "__main__":
    main()
