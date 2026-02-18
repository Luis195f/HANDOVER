from dataclasses import dataclass

import pytest
from rest_framework.test import APIClient

from backend.api.models import Patient


@dataclass
class DummyUser:
    claims: dict

    @property
    def is_authenticated(self) -> bool:
        return True


@pytest.mark.django_db
def test_post_patients_returns_201_and_persists_patient():
    client = APIClient()
    client.force_authenticate(
        user=DummyUser(claims={"permissions": ["patients:write", "patients:read"]}),
        token={"permissions": ["patients:write", "patients:read"]},
    )

    payload = {
        "first_name": "Ana",
        "last_name": "García",
        "identifier": "NHC123",
        "unit": "icu-a",
        "service": "cardio",
        "room": "101",
        "active": True,
    }

    response = client.post("/api/patients/", payload, format="json")

    assert response.status_code == 201
    body = response.json()
    assert isinstance(body.get("id"), int)
    assert body["identifier"] == "NHC123"

    created = Patient.objects.get(id=body["id"])
    assert created.first_name == "Ana"
    assert created.last_name == "García"
    assert created.unit == "icu-a"
    assert created.external_fhir_id is None
    assert created.fhir_sync_enabled is None


@pytest.mark.django_db
def test_get_patients_and_filter_unit_include_created_patient():
    patient = Patient.objects.create(
        first_name="Ana",
        last_name="García",
        identifier="NHC123",
        unit="icu-a",
        service="cardio",
        room="101",
        active=True,
    )
    Patient.objects.create(
        first_name="Luis",
        last_name="Pérez",
        identifier="NHC124",
        unit="icu-b",
        service="neuro",
        room="102",
        active=True,
    )

    client = APIClient()
    client.force_authenticate(
        user=DummyUser(claims={"permissions": ["patients:read"]}),
        token={"permissions": ["patients:read"]},
    )

    response_all = client.get("/api/patients/")
    assert response_all.status_code == 200
    bundle_all = response_all.json()
    assert bundle_all.get("resourceType") == "Bundle"
    all_resources = [e["resource"] for e in bundle_all.get("entry", [])]
    assert any(item["id"] == patient.id for item in all_resources)

    response_filtered = client.get("/api/patients/?unit=icu-a")
    assert response_filtered.status_code == 200
    bundle_filtered = response_filtered.json()
    assert bundle_filtered.get("resourceType") == "Bundle"
    filtered_resources = [e["resource"] for e in bundle_filtered.get("entry", [])]
    assert len(filtered_resources) == 1
    assert filtered_resources[0]["id"] == patient.id
    assert filtered_resources[0]["unit"] == "icu-a"


@pytest.mark.django_db
def test_post_patients_accepts_future_fhir_fields_without_breaking_current_behavior():
    client = APIClient()
    client.force_authenticate(
        user=DummyUser(claims={"permissions": ["patients:write", "patients:read"]}),
        token={"permissions": ["patients:write", "patients:read"]},
    )

    payload = {
        "first_name": "Marta",
        "last_name": "López",
        "identifier": "NHC999",
        "unit": "icu-c",
        "service": "trauma",
        "room": "201",
        "active": True,
        "external_fhir_id": "fhir-pat-1",
        "external_reference": "ehr:alpha:patient-1",
        "fhir_sync_enabled": True,
    }

    response = client.post("/api/patients/", payload, format="json")
    assert response.status_code == 201
    body = response.json()
    assert body["external_fhir_id"] == "fhir-pat-1"
    assert body["external_reference"] == "ehr:alpha:patient-1"
    assert body["fhir_sync_enabled"] is True
    assert body["synced_to_fhir"] is None


@pytest.mark.django_db
def test_get_patients_serializes_optional_fhir_fields_when_present():
    patient = Patient.objects.create(
        first_name="Eva",
        last_name="Campos",
        identifier="NHC555",
        unit="icu-z",
        service="neuro",
        room="300",
        active=True,
        external_fhir_id="fhir-555",
        external_reference="ehr:beta:555",
        fhir_sync_enabled=True,
        synced_to_fhir=True,
        fhir_sync_error="",
    )

    client = APIClient()
    client.force_authenticate(
        user=DummyUser(claims={"permissions": ["patients:read"]}),
        token={"permissions": ["patients:read"]},
    )

    response = client.get("/api/patients/?unit=icu-z")
    assert response.status_code == 200
    bundle = response.json()
    entry = bundle["entry"][0]["resource"]
    assert entry["id"] == patient.id
    assert entry["external_fhir_id"] == "fhir-555"
    assert entry["external_reference"] == "ehr:beta:555"
    assert entry["fhir_sync_enabled"] is True
    assert entry["synced_to_fhir"] is True
