from dataclasses import dataclass

import pytest
from django.db import OperationalError
from rest_framework.test import APIClient

from backend.api import views as api_views
from backend.api.models import DemoPatient, Patient


@dataclass
class DummyUser:
    claims: dict

    @property
    def is_authenticated(self) -> bool:
        return True


def _auth_claims(
    *,
    roles: list[str],
    permissions: list[str],
    unit_ids: list[str] | None = None,
) -> dict:
    claims = {
        "roles": roles,
        "permissions": permissions,
    }
    if unit_ids is not None:
        claims["unitIds"] = unit_ids
    return claims


class DummyHttpResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


@pytest.mark.django_db
def test_post_patients_returns_201_and_persists_patient():
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:write", "patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
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
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    response_all = client.get("/api/patients/")
    assert response_all.status_code == 200
    bundle_all = response_all.json()
    assert bundle_all.get("resourceType") == "Bundle"
    all_resources = [e["resource"] for e in bundle_all.get("entry", [])]
    assert any(item["id"] == patient.id for item in all_resources)
    assert all(item["unit"] == "icu-a" for item in all_resources)

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
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:write", "patients:read"],
        unit_ids=["icu-c"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
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
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-z"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
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


@pytest.mark.django_db
def test_get_patients_returns_503_when_local_registry_table_missing(monkeypatch):
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    def raise_missing_table(*args, **kwargs):
        raise OperationalError("no such table: api_patient")

    monkeypatch.setattr(Patient.objects, "all", raise_missing_table)

    response = client.get("/api/patients/")

    assert response.status_code == 503
    body = response.json()
    assert body["code"] == "local_registry_not_ready"


@pytest.mark.django_db
def test_post_patients_returns_503_when_local_registry_table_missing(monkeypatch):
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:write", "patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    payload = {
        "first_name": "Ana",
        "last_name": "García",
        "identifier": "NHC777",
        "unit": "icu-a",
        "service": "cardio",
        "room": "101",
        "active": True,
    }

    def raise_missing_table(*args, **kwargs):
        raise OperationalError("no such table: api_patient")

    monkeypatch.setattr(Patient.objects, "create", raise_missing_table)

    response = client.post("/api/patients/", payload, format="json")

    assert response.status_code == 503
    body = response.json()
    assert body["code"] == "local_registry_not_ready"


@pytest.mark.django_db
def test_get_patients_requires_clinical_or_viewer_role_even_with_scope():
    client = APIClient()
    claims = _auth_claims(
        roles=[],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    response = client.get("/api/patients/?unit=icu-a")

    assert response.status_code == 403


@pytest.mark.django_db
def test_get_patients_rejects_unit_outside_scope():
    Patient.objects.create(
        first_name="Ana",
        last_name="García",
        identifier="NHC125",
        unit="icu-b",
        service="neuro",
        room="102",
        active=True,
    )
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    response = client.get("/api/patients/?unit=icu-b")

    assert response.status_code == 403
    assert response.json()["code"] == "patients_forbidden_unit"


@pytest.mark.django_db
def test_get_patients_without_unit_filter_is_scoped_to_authorized_units():
    allowed = Patient.objects.create(
        first_name="Ana",
        last_name="García",
        identifier="NHC126",
        unit="icu-a",
        service="cardio",
        room="101",
        active=True,
    )
    Patient.objects.create(
        first_name="Luis",
        last_name="Pérez",
        identifier="NHC127",
        unit="icu-b",
        service="neuro",
        room="102",
        active=True,
    )
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    response = client.get("/api/patients/")

    assert response.status_code == 200
    bundle = response.json()
    resources = [entry["resource"] for entry in bundle.get("entry", [])]
    assert [item["id"] for item in resources] == [allowed.id]
    assert all(item["unit"] == "icu-a" for item in resources)


@pytest.mark.django_db
def test_post_patients_rejects_unit_outside_scope():
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:write", "patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    payload = {
        "first_name": "Ana",
        "last_name": "García",
        "identifier": "NHC778",
        "unit": "icu-b",
        "service": "cardio",
        "room": "101",
        "active": True,
    }

    response = client.post("/api/patients/", payload, format="json")

    assert response.status_code == 403
    assert response.json()["code"] == "patients_forbidden_unit"


@pytest.mark.django_db
def test_get_patients_without_unit_filter_aggregates_remote_units_for_multi_unit_scope(monkeypatch):
    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a", "icu-b"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    requested_units: list[str] = []

    def fake_remote_get(url, *, params, headers, timeout):
        unit_id = str(params["unit"])
        requested_units.append(unit_id)
        return DummyHttpResponse(
            200,
            {
                "resourceType": "Bundle",
                "type": "searchset",
                "total": 1,
                "entry": [
                    {
                        "resource": {
                            "resourceType": "Patient",
                            "id": f"remote-{unit_id}",
                            "extension": [
                                {
                                    "url": "https://handover.dev/fhir/StructureDefinition/unit-id",
                                    "valueString": unit_id,
                                }
                            ],
                        }
                    }
                ],
            },
        )

    monkeypatch.setattr(api_views.httpx, "get", fake_remote_get)

    response = client.get("/api/patients/")

    assert response.status_code == 200
    bundle = response.json()
    resources = [entry["resource"] for entry in bundle.get("entry", [])]
    assert requested_units == ["icu-a", "icu-b"]
    assert sorted(resource["id"] for resource in resources) == ["remote-icu-a", "remote-icu-b"]
    assert bundle["total"] == 2


@pytest.mark.django_db
def test_get_patients_demo_fallback_is_filtered_to_authorized_units(monkeypatch):
    DemoPatient.objects.create(
        external_id="demo-icu-a",
        given_name="Ana",
        family_name="Garcia",
        gender="female",
        unit_id="icu-a",
    )
    DemoPatient.objects.create(
        external_id="demo-icu-b",
        given_name="Luis",
        family_name="Perez",
        gender="male",
        unit_id="icu-b",
    )

    client = APIClient()
    claims = _auth_claims(
        roles=["nurse"],
        permissions=["patients:read"],
        unit_ids=["icu-a"],
    )
    client.force_authenticate(
        user=DummyUser(claims=claims),
        token=claims,
    )

    def raise_http_error(*args, **kwargs):
        raise api_views.httpx.HTTPError("fhir-down")

    monkeypatch.setattr(api_views.httpx, "get", raise_http_error)

    response = client.get("/api/patients/")

    assert response.status_code == 200
    bundle = response.json()
    resources = [entry["resource"] for entry in bundle.get("entry", [])]
    assert [resource["id"] for resource in resources] == ["demo-icu-a"]
