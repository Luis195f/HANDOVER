# main.py
import base64
import datetime
import logging
import os
from typing import Any, Dict, Optional

import django
import httpx
from fastapi import File, Form, Header, HTTPException, Request, UploadFile
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.conf import settings

from backend.ai_client import (
    ClinicalContext,
    SuggestionsResponse,
    generate_intervention_suggestions,
    generate_sbar,
    transcribe_audio,
)
from backend.audit.service import emit_audit_event
from backend.audit.utils import canonical_json, hash_payload
from backend.signature import (
    SignatureSettings,
    SignatureVerificationError,
    load_settings,
    record_signature_audit,
    sign_bundle,
    verify_bundle_signature,
)
from backend.validation import validate_fhir_bundle

FHIR_BASE = os.environ.get("FHIR_BASE", "http://localhost:8080/fhir")
FHIR_TOKEN = os.environ.get("FHIR_TOKEN", "")
HANDOVER_FHIR_VALIDATION_MODE = os.getenv("HANDOVER_FHIR_VALIDATION_MODE", "off")
AI_SUGGESTIONS_ENABLED = (
    os.getenv("AI_SUGGESTIONS_ENABLED", "true").lower() in ["1", "true", "yes", "on"]
)
SIGNATURE_SETTINGS: SignatureSettings = load_settings()

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_MIME_TYPES = {
    "audio/m4a",
    "audio/mp3",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/x-m4a",
}
MAX_FREE_TEXT_LENGTH = 15000

app = FastAPI(title="handover-api")
allowed_origins = [o for o in os.getenv("HANDOVER_ALLOWED_ORIGINS", "").split(",") if o] or [
    "http://localhost",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class CSPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(CSPMiddleware)


class SbarRequest(BaseModel):
    language: str = "es"
    free_text: str
    context: Optional[Dict[str, Any]] = None


class SbarResponse(BaseModel):
    situation: str
    background: str
    assessment: str
    recommendation: str
    full_text: str


def auth_headers():
    h = {"Content-Type": "application/fhir+json"}
    if FHIR_TOKEN:
        h["Authorization"] = f"Bearer {FHIR_TOKEN}"
    return h


def _parse_signature_when(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        return datetime.datetime.fromisoformat(normalized)
    except Exception:
        return None

async def create_audit_event(client: httpx.AsyncClient, *,
                             bundle: dict,
                             user_id: str | None,
                             unit_id: str | None,
                             ip: str | None):
    """Crea un AuditEvent R4 mínimo por cada transacción."""
    # intentar sacar PatientId (si viene como campo auxiliar en tu bundle; opcional)
    patient_id = None
    composition = None
    outgoing_attester = None
    incoming_attester = None
    try:
        for e in (bundle.get("entry") or []):
            r = (e or {}).get("resource") or {}
            if r.get("resourceType") == "Patient":
                pid = r.get("id")
                if pid:
                    patient_id = pid
            if r.get("resourceType") == "Composition" and not composition:
                composition = r
                attesters = r.get("attester") or []
                if attesters:
                    outgoing_attester = attesters[0]
                    if len(attesters) > 1:
                        incoming_attester = attesters[1]
    except Exception:
        pass

    def agent_from_attester(attester: dict | None, label: str):
        if not attester:
            return None
        party = attester.get("party") or {}
        identifier = (party.get("identifier") or {}).get("value")
        reference = party.get("reference")
        who_value = identifier or reference
        if not who_value:
            return None
        display = party.get("display") or who_value
        return {
            "type": {"text": label},
            "who": {"identifier": {"system": "urn:handover:user-id", "value": who_value}, "display": display},
            "requestor": False,
        }

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

    outgoing_agent = agent_from_attester(outgoing_attester, "outgoing-nurse-signature")
    incoming_agent = agent_from_attester(incoming_attester, "incoming-nurse-signature")
    if outgoing_agent:
        audit["agent"].append(outgoing_agent)
    if incoming_agent:
        audit["agent"].append(incoming_agent)

    if patient_id:
        audit["entity"] = [{"what": {"reference": f"Patient/{patient_id}"}}]

    has_outgoing_signature = outgoing_agent is not None
    has_incoming_signature = incoming_agent is not None
    if composition:
        composition_id = composition.get("id") or "unknown"
        signature_value = (
            ("outgoingSigned" if has_outgoing_signature else "notSigned")
            + (";incomingSigned" if has_incoming_signature else ";incomingNotSigned")
        )
        audit["entity"] = (audit.get("entity") or []) + [
            {
                "what": {"reference": f"Composition/{composition_id}"},
                "detail": [
                    {
                        "type": "signature-status",
                        "valueString": signature_value,
                    }
                ],
            }
        ]

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
        await validate_fhir_bundle(
            bundle=bundle,
            client=client,
            base_url=FHIR_BASE,
            validation_mode=HANDOVER_FHIR_VALIDATION_MODE,
        )
        if SIGNATURE_SETTINGS.enabled:
            try:
                verification = verify_bundle_signature(bundle, settings=SIGNATURE_SETTINGS)
            except SignatureVerificationError:
                raise HTTPException(status_code=400, detail="Invalid signature")
            except Exception as exc:
                raise HTTPException(status_code=400, detail=str(exc))

            if verification:
                record_signature_audit(
                    user_id=x_user_id,
                    bundle_hash=verification.bundle_hash,
                    signature_b64=verification.signature_b64,
                    signed_at=_parse_signature_when(
                        bundle.get("signature", {}).get("when") if isinstance(bundle.get("signature"), dict) else None
                    ),
                )
            else:
                signature = sign_bundle(bundle, user_id=x_user_id, settings=SIGNATURE_SETTINGS)
                if signature:
                    bundle["signature"] = signature.fhir_signature
                    record_signature_audit(
                        user_id=x_user_id,
                        bundle_hash=signature.bundle_hash,
                        signature_b64=signature.signature_b64,
                        signed_at=_parse_signature_when(signature.fhir_signature.get("when")),
                    )
        else:
            logger.info("Firma digital de Bundle deshabilitada; se reenvía sin firma/validación criptográfica.")
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


MAX_NOTES_LENGTH = 500


def _build_sbar_input(req: SbarRequest) -> tuple[str, dict]:
    base_text = (req.free_text or "").strip()
    if len(base_text) > MAX_NOTES_LENGTH:
        base_text = base_text[:MAX_NOTES_LENGTH].rstrip() + "…"

    context = req.context or {}
    if not isinstance(context, dict) or not context:
        return base_text, {}
    context_lines = []
    for key, value in context.items():
        if value is None:
            continue
        context_lines.append(f"{key}: {value}")
    if not context_lines:
        return base_text, {}
    if base_text:
        return base_text + "\n\nContexto estructurado:\n" + "\n".join(context_lines), context
    return "Contexto estructurado:\n" + "\n".join(context_lines), context


def _audit_ai_summary(
    *,
    status: str,
    http_status: int,
    user_sub: str | None,
    notes: str,
    context: dict,
    language: str,
    request: Request | None,
) -> None:
    payload_obj = {
        "notes": notes,
        "context": context,
        "language": language,
    }
    try:
        payload_hash = hash_payload(payload_obj, settings.AUDIT_HASH_SECRET)
        payload_size = len(canonical_json(payload_obj))
        emit_audit_event(
            event_type="ai_summary_generated",
            action="execute",
            status=status,
            http_status=http_status,
            user_sub=user_sub,
            resource_type="SBAR",
            resource_id="",
            payload_hash=payload_hash,
            payload_size=payload_size,
            meta={
                "model": OPENAI_MODEL_SBAR,
                "promptVersion": "v1",
                "ip": request.client.host if request and request.client else "",
            },
        )
    except Exception:
        logger.exception("No se pudo registrar auditoría de IA")


@app.post("/ai/transcribe")
async def ai_transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
) -> dict:
    content_type = (file.content_type or "").split(";")[0]
    if content_type not in ALLOWED_AUDIO_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Audio inválido o formato no soportado")

    try:
        text = await transcribe_audio(file, language)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Error al procesar el audio con el servicio de IA")

    return {"text": text, "language": language or "es", "durationSeconds": None}


@app.post("/ai/summarize-sbar", response_model=SbarResponse)
async def summarize_sbar(
    req: SbarRequest,
    request: Request,
    x_user_id: str | None = Header(None),
) -> SbarResponse:
    if len(req.free_text or "") > MAX_FREE_TEXT_LENGTH:
        _audit_ai_summary(
            status="fail",
            http_status=400,
            user_sub=x_user_id,
            notes=(req.free_text or "")[:MAX_NOTES_LENGTH],
            context=req.context or {},
            language=req.language or "es",
            request=request,
        )
        raise HTTPException(status_code=400, detail="Texto demasiado largo para resumir")

    combined_text, context = _build_sbar_input(req)
    notes = (req.free_text or "").strip()
    if len(notes) > MAX_NOTES_LENGTH:
        notes = notes[:MAX_NOTES_LENGTH].rstrip() + "…"
    try:
        payload = await generate_sbar(combined_text, language=req.language or "es")
    except HTTPException:
        _audit_ai_summary(
            status="fail",
            http_status=502,
            user_sub=x_user_id,
            notes=notes,
            context=context,
            language=req.language or "es",
            request=request,
        )
        raise
    except Exception:
        _audit_ai_summary(
            status="fail",
            http_status=502,
            user_sub=x_user_id,
            notes=notes,
            context=context,
            language=req.language or "es",
            request=request,
        )
        raise HTTPException(status_code=502, detail="Error al generar SBAR con el servicio de IA")

    required_keys = ["situation", "background", "assessment", "recommendation", "full_text"]
    if not all(isinstance(payload.get(key), str) for key in required_keys):
        _audit_ai_summary(
            status="fail",
            http_status=502,
            user_sub=x_user_id,
            notes=notes,
            context=context,
            language=req.language or "es",
            request=request,
        )
        raise HTTPException(status_code=502, detail="Formato de respuesta de IA inesperado")

    _audit_ai_summary(
        status="success",
        http_status=200,
        user_sub=x_user_id,
        notes=notes,
        context=context,
        language=req.language or "es",
        request=request,
    )
    return SbarResponse(**payload)


@app.post("/ai/suggest-interventions", response_model=SuggestionsResponse)
async def suggest_interventions(ctx: ClinicalContext) -> SuggestionsResponse:
    if not AI_SUGGESTIONS_ENABLED:
        raise HTTPException(status_code=404, detail="Sugerencias de IA deshabilitadas")

    try:
        payload = await generate_intervention_suggestions(ctx)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Formato de respuesta de IA inesperado") from exc
    except Exception:
        raise HTTPException(status_code=502, detail="Error al generar sugerencias con IA")

    return payload
