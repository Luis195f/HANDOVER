import pytest
from rest_framework.test import APIClient

from backend.api.models import ClinicalDecisionEvent
from backend.security.auth import Auth0User


def _auth_client(
    *,
    roles=("nurse",),
    permissions=("handover:write",),
    unit_ids=("icu-a",),
    sub="auth0|clinician-1",
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


def _payload(**overrides):
    payload = {
        "patientId": "pat-001",
        "unitId": "icu-a",
        "suggestionSource": "ai_nic_suggestions",
        "decision": "applied",
        "reasonCode": "selection_applied",
        "metadata": {
            "section": "treatments",
            "selectedCount": 2,
            "suggestionCount": 4,
            "selectedCodes": ["2210"],
            "suggestionHashes": [
                "d0f12c3d3f0f5db1f0d1d3a6e6f1fd05cf5b87d42b3681e3016e1f656b1f9499",
            ],
        },
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
def test_clinical_decision_endpoint_creates_event_for_authorized_user():
    client = _auth_client()

    response = client.post("/api/ai/clinical-decision", data=_payload(), format="json")

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "recorded"
    assert body["decision"] == "applied"

    event = ClinicalDecisionEvent.objects.get()
    assert str(event.decision_id) == body["decisionId"]
    assert event.patient_id == "pat-001"
    assert event.unit_id == "icu-a"
    assert event.actor_id == "auth0|clinician-1"
    assert event.actor_role == "nurse"
    assert event.suggestion_source == "ai_nic_suggestions"
    assert event.reason_code == "selection_applied"
    assert event.metadata["selectedCodes"] == ["2210"]
    assert event.suggestion_version


@pytest.mark.django_db
def test_clinical_decision_endpoint_rejects_invalid_payload():
    client = _auth_client()

    response = client.post(
        "/api/ai/clinical-decision",
        data=_payload(metadata={"unsupported": True}),
        format="json",
    )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "invalid_clinical_decision_payload"
    assert ClinicalDecisionEvent.objects.count() == 0


@pytest.mark.django_db
def test_clinical_decision_endpoint_forbids_missing_scope():
    client = _auth_client(permissions=("patients:read",))

    response = client.post("/api/ai/clinical-decision", data=_payload(), format="json")

    assert response.status_code == 403
    assert ClinicalDecisionEvent.objects.count() == 0


@pytest.mark.django_db
def test_clinical_decision_endpoint_forbids_unit_outside_scope():
    client = _auth_client(unit_ids=("icu-a",))

    response = client.post(
        "/api/ai/clinical-decision",
        data=_payload(unitId="ward-b"),
        format="json",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "patients_forbidden_unit"
    assert ClinicalDecisionEvent.objects.count() == 0


@pytest.mark.django_db
def test_clinical_decision_endpoint_accepts_sbar_apply_and_derives_model_version():
    client = _auth_client()

    response = client.post(
        "/api/ai/clinical-decision",
        data=_payload(
            suggestionSource="ai_generate_sbar",
            reasonCode="direct_apply",
            metadata={
                "section": "sbar",
                "suggestionCount": 1,
                "selectedCount": 1,
                "replaceExisting": True,
                "suggestionHashes": [
                    "b50c4b36780e8bf0b8afcac9b32f1d8dcf00d747c2e9d92f0b7ea9dc89c3104a",
                ],
            },
        ),
        format="json",
    )

    assert response.status_code == 201
    event = ClinicalDecisionEvent.objects.get()
    assert event.suggestion_source == "ai_generate_sbar"
    assert event.suggestion_version
    assert event.metadata["replaceExisting"] is True
