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

