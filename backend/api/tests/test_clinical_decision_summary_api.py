import json
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from backend.api.models import ClinicalDecisionEvent
from backend.security.auth import Auth0User


def _auth_client(
    *,
    roles=("supervisor",),
    permissions=("handover:write",),
    unit_ids=("icu-a",),
    sub="auth0|leader-1",
):
    claims = {
        "sub": sub,
        "roles": list(roles),
        "permissions": list(permissions),
        "unitIds": list(unit_ids),
    }
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=sub, claims=claims), token=claims)
    client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")
    return client


def _admin_client():
    return _auth_client(roles=("admin",), unit_ids=("icu-a",))


def _create_event(
    *,
    unit_id: str,
    suggestion_source: str,
    decision: str,
    actor_id: str,
    created_at,
    section: str | None = None,
):
    event = ClinicalDecisionEvent.objects.create(
        handover_id="handover-1",
        patient_id="pat-001",
        unit_id=unit_id,
        actor_id=actor_id,
        actor_role="nurse",
        suggestion_source=suggestion_source,
        suggestion_version="test-model",
        decision=decision,
        reason_code="selection_applied" if decision == "applied" else "user_discarded_batch",
        metadata={"section": section} if section else {},
    )
    ClinicalDecisionEvent.objects.filter(pk=event.pk).update(created_at=created_at)
    return ClinicalDecisionEvent.objects.get(pk=event.pk)


@pytest.mark.django_db
def test_clinical_decision_summary_returns_aggregated_non_nominal_payload():
    now = timezone.now()
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_nic_suggestions",
        decision="applied",
        actor_id="auth0|nurse-1",
        created_at=now - timedelta(days=1),
        section="treatments",
    )
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_nic_suggestions",
        decision="dismissed",
        actor_id="auth0|nurse-2",
        created_at=now - timedelta(days=1),
        section="treatments",
    )
    _create_event(
        unit_id="ward-b",
        suggestion_source="ai_generate_sbar",
        decision="applied",
        actor_id="auth0|nurse-3",
        created_at=now,
        section="sbar",
    )

    response = _admin_client().get("/api/clinical-decisions/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["totals"]["events"] == 3
    assert {item["decision"]: item["count"] for item in body["byDecision"]} == {
        "applied": 2,
        "dismissed": 1,
    }
    assert {item["unitId"]: item["count"] for item in body["byUnit"]} == {
        "icu-a": 2,
        "ward-b": 1,
    }
    assert any(item["suggestionSource"] == "ai_nic_suggestions" and item["decisions"]["dismissed"] == 1 for item in body["bySuggestionSource"])
    assert any(item["section"] == "treatments" and item["decisions"]["applied"] == 1 for item in body["bySection"])
    assert len(body["timeline"]) == 2

    serialized = json.dumps(body)
    assert "actor_id" not in serialized
    assert "actorId" not in serialized
    assert "auth0|nurse-1" not in serialized
    assert "note" not in serialized


@pytest.mark.django_db
def test_clinical_decision_summary_supervisor_without_unit_id_only_sees_authorized_units():
    now = timezone.now()
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_nic_suggestions",
        decision="applied",
        actor_id="auth0|nurse-1",
        created_at=now - timedelta(days=1),
        section="treatments",
    )
    _create_event(
        unit_id="ward-b",
        suggestion_source="ai_nic_suggestions",
        decision="dismissed",
        actor_id="auth0|nurse-2",
        created_at=now,
        section="treatments",
    )

    response = _auth_client(unit_ids=("icu-a",)).get("/api/clinical-decisions/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["events"] == 1
    assert body["byUnit"] == [{"unitId": "icu-a", "count": 1}]
    assert body["filters"]["unitId"] is None


@pytest.mark.django_db
def test_clinical_decision_summary_supervisor_cannot_query_unit_outside_scope():
    response = _auth_client(unit_ids=("icu-a",)).get(
        "/api/clinical-decisions/summary",
        {"unitId": "ward-b"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "patients_forbidden_unit"


@pytest.mark.django_db
def test_clinical_decision_summary_filters_by_unit_dates_source_decision_and_section():
    now = timezone.now()
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_noc_suggestions",
        decision="dismissed",
        actor_id="auth0|nurse-1",
        created_at=now - timedelta(days=10),
        section="outcomes",
    )
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_noc_suggestions",
        decision="applied",
        actor_id="auth0|nurse-2",
        created_at=now - timedelta(days=2),
        section="outcomes",
    )
    _create_event(
        unit_id="ward-b",
        suggestion_source="ai_noc_suggestions",
        decision="applied",
        actor_id="auth0|nurse-3",
        created_at=now - timedelta(days=2),
        section="outcomes",
    )

    response = _auth_client().get(
        "/api/clinical-decisions/summary",
        {
            "unitId": "icu-a",
            "suggestionSource": "ai_noc_suggestions",
            "decision": "applied",
            "section": "outcomes",
            "dateFrom": (now - timedelta(days=3)).date().isoformat(),
            "dateTo": now.date().isoformat(),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["events"] == 1
    assert body["filters"]["unitId"] == "icu-a"
    assert body["filters"]["suggestionSource"] == "ai_noc_suggestions"
    assert body["filters"]["decision"] == "applied"
    assert body["filters"]["section"] == "outcomes"
    assert body["filters"]["dateFrom"] == (now - timedelta(days=3)).date().isoformat()
    assert body["filters"]["dateTo"] == now.date().isoformat()
    assert body["queryBounds"]["createdAtLt"].startswith((now + timedelta(days=1)).date().isoformat())
    assert body["byDecision"] == [{"decision": "applied", "count": 1}]
    assert body["byUnit"] == [{"unitId": "icu-a", "count": 1}]
    assert body["bySection"][0]["section"] == "outcomes"


@pytest.mark.django_db
def test_clinical_decision_summary_forbids_nurse_role():
    response = _auth_client(roles=("nurse",)).get("/api/clinical-decisions/summary")

    assert response.status_code == 403


@pytest.mark.django_db
def test_clinical_decision_summary_rejects_invalid_date_query():
    response = _auth_client().get("/api/clinical-decisions/summary", {"dateFrom": "not-a-date"})

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_clinical_decision_summary_query"


@pytest.mark.django_db
def test_clinical_decision_summary_admin_can_query_global_rollout_enabled(monkeypatch, settings):
    settings.HANDOVER_DEPLOYMENT_MODE = "production"
    monkeypatch.setenv(
        "HANDOVER_PILOT_CONTROL_JSON",
        json.dumps(
            {
                "pilotMode": "enabled",
                "rolloutStatus": "go",
                "enabledUnits": ["icu-a"],
                "features": {
                    "admin_analytics": {
                        "mode": "enabled",
                        "enabledUnits": ["icu-a"],
                        "allowedRoles": ["supervisor", "admin"],
                    }
                },
            }
        ),
    )
    now = timezone.now()
    _create_event(
        unit_id="icu-a",
        suggestion_source="ai_nic_suggestions",
        decision="applied",
        actor_id="auth0|nurse-1",
        created_at=now,
        section="treatments",
    )
    _create_event(
        unit_id="ward-b",
        suggestion_source="ai_generate_sbar",
        decision="dismissed",
        actor_id="auth0|nurse-2",
        created_at=now,
        section="sbar",
    )

    response = _admin_client().get("/api/clinical-decisions/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["totals"]["events"] == 2
    assert {item["unitId"] for item in body["byUnit"]} == {"icu-a", "ward-b"}


@pytest.mark.django_db
def test_clinical_decision_summary_supervisor_respects_rollout_gate_for_requested_unit(monkeypatch, settings):
    settings.HANDOVER_DEPLOYMENT_MODE = "production"
    monkeypatch.setenv(
        "HANDOVER_PILOT_CONTROL_JSON",
        json.dumps(
            {
                "pilotMode": "enabled",
                "rolloutStatus": "go",
                "enabledUnits": ["icu-a"],
                "features": {
                    "admin_analytics": {
                        "mode": "enabled",
                        "enabledUnits": ["icu-a"],
                        "allowedRoles": ["supervisor", "admin"],
                    }
                },
            }
        ),
    )

    response = _auth_client(unit_ids=("icu-a", "ward-b")).get("/api/clinical-decisions/summary", {"unitId": "ward-b"})

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False
    assert body["enabled"] is False
    assert body["unavailableReason"] == "unit_out_of_scope"
