# main.py
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Request
from fastapi.middleware.cors import CORSMiddleware
import os, base64, httpx, datetime

FHIR_BASE = os.environ.get("FHIR_BASE", "http://localhost:8080/fhir")
FHIR_TOKEN = os.environ.get("FHIR_TOKEN", "")

app = FastAPI(title="handover-api")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

def auth_headers():
    h = {"Content-Type": "application/fhir+json"}
    if FHIR_TOKEN:
        h["Authorization"] = f"Bearer {FHIR_TOKEN}"
    return h

async def create_audit_event(client: httpx.AsyncClient, *,
                             bundle: dict,
                             user_id: str | None,
                             unit_id: str | None,
                             ip: str | None):
    """Crea un AuditEvent R4 mínimo por cada transacción."""
    # intentar sacar PatientId (si viene como campo auxiliar en tu bundle; opcional)
    patient_id = None
    try:
      for e in (bundle.get("entry") or []):
          r = (e or {}).get("resource") or {}
          if r.get("resourceType") == "Patient":
              pid = r.get("id")
              if pid:
                  patient_id = pid
                  break
    except Exception:
      pass

    audit = {
        "resourceType": "AuditEvent",
        "type": {  # RESTful operation
            "system": "http://terminology.hl7.org/CodeSystem/audit-event-type",
            "code": "rest",
            "display": "RESTful Operation",
        },
        "subtype": [{
            "system": "http://hl7.org/fhir/restful-interaction",
            "code": "transaction",
            "display": "transaction",
        }],
        "action": "C",  # Create
        "recorded": datetime.datetime.utcnow().isoformat() + "Z",
        "outcome": "0",
        "agent": [{
            "type": {"text": "human/user"},
            "who": {"identifier": {"value": user_id or "anonymous"}},
            "requestor": True,
            "network": {
                "address": ip or "0.0.0.0",
                "type": "2"  # 2 = IP
            },
            "location": {"identifier": {"value": unit_id or ""}}
        }],
        "source": {
            "observer": {"identifier": {"value": "handover-api"}},
        },
    }
    if patient_id:
        audit["entity"] = [{"what": {"reference": f"Patient/{patient_id}"}}]

    r = await client.post(f"{FHIR_BASE}/AuditEvent", json=audit, headers=auth_headers())
    # No levantar excepción si el servidor no soporta AuditEvent (no bloquea el MVP)
    try:
        r.raise_for_status()
    except Exception:
        pass

@app.post("/fhir/transaction")
async def fhir_transaction(bundle: dict,
                           request: Request,
                           x_user_id: str | None = Header(None),
                           x_unit_id: str | None = Header(None)):
    """Proxy transparente: reenvía Transaction Bundle al FHIR y emite un AuditEvent."""
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{FHIR_BASE}", json=bundle, headers=auth_headers())
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)

        # AuditEvent (no bloqueante)
        try:
            await create_audit_event(
                client,
                bundle=bundle,
                user_id=x_user_id,
                unit_id=x_unit_id,
                ip=(request.client.host if request.client else None),
            )
        finally:
            return r.json()

@app.post("/upload/audio-to-fhir")
async def audio_to_fhir(patientId: str = Form(...),
                        label: str = Form("Handover Audio"),
                        encounterRef: str | None = Form(None),
                        file: UploadFile = File(...)):
    data = await file.read()
    b64 = base64.b64encode(data).decode("utf-8")
    now = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
    doc = {
        "resourceType": "DocumentReference",
        "status": "current",
        "type": {"text": label},
        "subject": {"reference": f"Patient/{patientId}"},
        "date": now,
        **({"context": {"encounter": [{"reference": encounterRef}]}} if encounterRef else {}),
        "content": [{"attachment": {"contentType": file.content_type or "audio/mpeg",
                                    "data": b64, "title": file.filename}}],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{FHIR_BASE}/DocumentReference", json=doc, headers=auth_headers())
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()
