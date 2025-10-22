import json
import base64
import httpx
import respx
from fastapi.testclient import TestClient
from main import app, FHIR_BASE

client = TestClient(app)

# Bundle de ejemplo "válido" a nivel contrato, sin imponer codificaciones concretas
# (asumimos que tu front ya mapea Encounter/Observations/DocumentReference).
SAMPLE_BUNDLE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "entry": [
        # Encounter mínimo
        {
            "request": {"method": "POST", "url": "Encounter"},
            "resource": {
                "resourceType": "Encounter",
                "status": "finished",
                "subject": {"reference": "Patient/pat-xyz"},
            },
        },
        # Observations (vital-signs) mínimas — comprobamos estructura, no códigos concretos
        {
            "request": {"method": "POST", "url": "Observation"},
            "resource": {
                "resourceType": "Observation",
                "status": "final",
                "category": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "vital-signs",
                            }
                        ]
                    }
                ],
                "code": {
                    "coding": [
                        {"system": "http://loinc.org", "code": "8480-6", "display": "Systolic blood pressure"}
                    ],
                    "text": "TAS",
                },
                "valueQuantity": {
                    "value": 120,
                    "unit": "mmHg",
                    "system": "http://unitsofmeasure.org",
                    "code": "mm[Hg]",
                },
                "subject": {"reference": "Patient/pat-xyz"},
            },
        },
        {
            "request": {"method": "POST", "url": "Observation"},
            "resource": {
                "resourceType": "Observation",
                "status": "final",
                "category": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "vital-signs",
                            }
                        ]
                    }
                ],
                "code": {
                    "coding": [{"system": "http://loinc.org", "code": "8462-4", "display": "Diastolic blood pressure"}],
                    "text": "TAD",
                },
                "valueQuantity": {
                    "value": 70,
                    "unit": "mmHg",
                    "system": "http://unitsofmeasure.org",
                    "code": "mm[Hg]",
                },
                "subject": {"reference": "Patient/pat-xyz"},
            },
        },
        {
            "request": {"method": "POST", "url": "Observation"},
            "resource": {
                "resourceType": "Observation",
                "status": "final",
                "category": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "vital-signs",
                            }
                        ]
                    }
                ],
                "code": {"coding": [{"system": "http://loinc.org"}], "text": "Temp"},
                "valueQuantity": {"value": 37.1, "unit": "°C"},
                "subject": {"reference": "Patient/pat-xyz"},
            },
        },
        # DocumentReference con audio embebido (base64)
        {
            "request": {"method": "POST", "url": "DocumentReference"},
            "resource": {
                "resourceType": "DocumentReference",
                "status": "current",
                "type": {"text": "Handover Audio"},
                "subject": {"reference": "Patient/pat-xyz"},
                "content": [
                    {
                        "attachment": {
                            "contentType": "audio/mpeg",
                            "title": "notes.mp3",
                            "data": base64.b64encode(b"fake-bytes").decode("utf-8"),
                        }
                    }
                ],
            },
        },
    ],
}

def _assert_vital_obs_shape(obs: dict):
    assert obs["resourceType"] == "Observation"
    assert obs.get("status") in ("final", "amended", "registered")
    # category vital-signs (no imponemos exactitud de codificación más allá del sistema/código)
    cats = obs.get("category") or []
    assert any(
        any(c.get("system") == "http://terminology.hl7.org/CodeSystem/observation-category" and c.get("code") == "vital-signs"
            for c in (cat.get("coding") or []))
        for cat in cats
    ), "Observation sin category vital-signs"
    # sujeto requerido
    assert obs.get("subject", {}).get("reference", "").startswith("Patient/"), "Observation sin subject Patient"
    # valor presente (aceptamos valueQuantity o valueCodeableConcept, etc.)
    assert any(
        k in obs for k in ("valueQuantity", "valueCodeableConcept", "valueString", "valueInteger", "valueRatio")
    ), "Observation sin valor"


def test_transaction_resources_contract_and_audit():
    def assert_and_return_ok(request: httpx.Request):
        body = json.loads(request.content.decode("utf-8"))
        assert body["resourceType"] == "Bundle" and body["type"] == "transaction"

        # Conteos por tipo
        resources = [e["resource"]["resourceType"] for e in body.get("entry", [])]
        assert resources.count("Encounter") >= 1, "Falta Encounter"
        assert resources.count("Observation") >= 1, "Faltan Observations"
        assert resources.count("DocumentReference") >= 1, "Falta DocumentReference"

        # Validar Encounter mínimo
        encs = [e["resource"] for e in body["entry"] if e["resource"]["resourceType"] == "Encounter"]
        enc = encs[0]
        assert enc.get("status") in ("in-progress", "finished", "planned")
        assert enc.get("subject", {}).get("reference", "").startswith("Patient/")

        # Validar Observations forma general
        for obs in (e["resource"] for e in body["entry"] if e["resource"]["resourceType"] == "Observation"):
            _assert_vital_obs_shape(obs)

        # Validar DocumentReference audio
        docs = [e["resource"] for e in body["entry"] if e["resource"]["resourceType"] == "DocumentReference"]
        doc = docs[0]
        assert doc.get("subject", {}).get("reference", "").startswith("Patient/")
        att = doc.get("content", [{}])[0].get("attachment", {})
        assert isinstance(att.get("data"), str) and len(att["data"]) > 0
        assert (att.get("contentType") or "").startswith("audio/")

        return httpx.Response(200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []})

    with respx.mock(base_url=FHIR_BASE) as mock:
        # interceptamos el POST "/" para validar la forma del bundle
        tx_route = mock.post("/").mock(side_effect=assert_and_return_ok)
        # y dejamos el AuditEvent como en el test anterior
        ae_route = mock.post("/AuditEvent").mock(
            return_value=httpx.Response(201, json={"resourceType": "AuditEvent", "id": "ae-2"})
        )

        r = client.post("/fhir/transaction", json=SAMPLE_BUNDLE,
                        headers={"X-User-Id": "nurse-88", "X-Unit-Id": "icu-adulto"})
        assert r.status_code == 200
        assert tx_route.called
        assert ae_route.called
