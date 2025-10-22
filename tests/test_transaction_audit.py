import json
import httpx
import respx
from fastapi.testclient import TestClient
from main import app, FHIR_BASE

client = TestClient(app)

SAMPLE_TX = {
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    {
      "request": {"method": "POST", "url": "Patient"},
      "resource": {"resourceType": "Patient", "id": "pat-xyz", "name": [{"text": "Juan Pérez"}]}
    }
  ]
}

def test_proxy_and_auditevent_ok():
    with respx.mock(base_url=FHIR_BASE) as mock:
        # 1) FHIR transaction ok
        tx_route = mock.post("/").mock(
            return_value=httpx.Response(200, json={"resourceType": "Bundle", "type": "transaction-response", "entry": []})
        )
        # 2) AuditEvent created
        ae_route = mock.post("/AuditEvent").mock(
            return_value=httpx.Response(201, json={"resourceType": "AuditEvent", "id": "ae-1"})
        )

        r = client.post("/fhir/transaction", json=SAMPLE_TX,
                        headers={"X-User-Id": "nurse-77", "X-Unit-Id": "icu-adulto"})
        assert r.status_code == 200
        assert tx_route.called, "La transacción no llegó al FHIR"
        assert ae_route.called, "No se emitió AuditEvent"

        # request es httpx.Request → parsear manualmente el cuerpo
        req = ae_route.calls[0].request
        ae_body = json.loads(req.content.decode("utf-8"))

        assert ae_body["type"]["code"] in ("rest", "110110")
        assert ae_body["subtype"][0]["code"] == "transaction"
        assert ae_body["agent"][0]["who"]["identifier"]["value"] == "nurse-77"
        # opcional si tu backend añade entity:
        # if "entity" in ae_body:
        #     assert ae_body["entity"][0]["what"]["reference"].startswith("Patient/")

def test_transaction_error_bubbles_up():
    with respx.mock(base_url=FHIR_BASE) as mock:
        mock.post("/").mock(return_value=httpx.Response(400, text="bad request"))
        r = client.post("/fhir/transaction", json=SAMPLE_TX)
        assert r.status_code == 400
