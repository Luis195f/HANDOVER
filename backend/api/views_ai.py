import base64
import datetime
import logging
import os
from typing import Any, Dict

import httpx
from asgiref.sync import async_to_sync
from django.conf import settings
from django.http import HttpRequest
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.ai_client import (
    ClinicalContext,
    OPENAI_MODEL_SBAR,
    generate_intervention_suggestions,
    generate_sbar,
    transcribe_audio,
)
from backend.audit.service import emit_audit_event
from backend.audit.utils import canonical_json, hash_payload
from backend.security.auth import Auth0JWTAuthentication
from backend.security.permissions_roles import HasAnyRole
from backend.security.scope_permissions import HasAnyScope
from rest_framework.views import APIView

from .views import FHIR_BASE, get_fhir_headers

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
MAX_NOTES_LENGTH = 500
AI_SUGGESTIONS_ENABLED = os.getenv("AI_SUGGESTIONS_ENABLED", "true").lower() in ["1", "true", "yes", "on"]


class AuthenticatedAPIView(APIView):
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [IsAuthenticated]


class TranscribeView(AuthenticatedAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: HttpRequest) -> Response:
        upload = request.FILES.get("file")
        language = request.data.get("language")
        if not upload:
            return Response({"detail": "Missing audio file"}, status=400)

        content_type = (getattr(upload, "content_type", "") or "").split(";")[0]
        if content_type not in ALLOWED_AUDIO_MIME_TYPES:
            return Response({"detail": "Audio inválido o formato no soportado"}, status=400)

        try:
            text = async_to_sync(transcribe_audio)(upload, language)
        except Exception:
            return Response({"detail": "Error al procesar el audio con el servicio de IA"}, status=502)

        return Response({"text": text, "language": language or "es", "durationSeconds": None}, status=200)


class SummarizeSbarView(AuthenticatedAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [JSONParser]

    @staticmethod
    def _truncate_audit_notes(text: str) -> str:
        if len(text) <= MAX_NOTES_LENGTH:
            return text
        return text[:MAX_NOTES_LENGTH].rstrip() + "…"

    @staticmethod
    def _build_sbar_input(free_text: str, context: Dict[str, Any]) -> tuple[str, dict]:
        base_text = (free_text or "").strip()
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
        self,
        *,
        status: str,
        http_status: int,
        user_sub: str | None,
        notes: str,
        context: dict,
        language: str,
    ) -> None:
        payload_obj = {"notes": notes, "context": context, "language": language}
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
                meta={"model": OPENAI_MODEL_SBAR, "promptVersion": "v1", "source": "ai/summarize-sbar"},
            )
        except Exception:
            logger.exception("No se pudo registrar auditoría de IA")

    def post(self, request: HttpRequest) -> Response:
        req = request.data if isinstance(request.data, dict) else {}
        free_text = req.get("free_text") or ""
        language = req.get("language") or "es"
        context = req.get("context") if isinstance(req.get("context"), dict) else {}
        user_id = request.headers.get("X-User-Id")

        if len(free_text) > MAX_FREE_TEXT_LENGTH:
            self._audit_ai_summary(
                status="fail",
                http_status=400,
                user_sub=user_id,
                notes=self._truncate_audit_notes(free_text.strip()),
                context=context,
                language=language,
            )
            return Response({"detail": "Texto demasiado largo para resumir"}, status=400)

        combined_text, ctx = self._build_sbar_input(free_text, context)
        notes = self._truncate_audit_notes(free_text.strip())

        try:
            payload = async_to_sync(generate_sbar)(combined_text, language=language)
        except Exception:
            self._audit_ai_summary(
                status="fail",
                http_status=502,
                user_sub=user_id,
                notes=notes,
                context=ctx,
                language=language,
            )
            return Response({"detail": "Error al generar SBAR con el servicio de IA"}, status=502)

        required_keys = ["situation", "background", "assessment", "recommendation", "full_text"]
        if not all(isinstance(payload.get(key), str) for key in required_keys):
            self._audit_ai_summary(
                status="fail",
                http_status=502,
                user_sub=user_id,
                notes=notes,
                context=ctx,
                language=language,
            )
            return Response({"detail": "Formato de respuesta de IA inesperado"}, status=502)

        self._audit_ai_summary(
            status="success",
            http_status=200,
            user_sub=user_id,
            notes=notes,
            context=ctx,
            language=language,
        )
        return Response(payload, status=200)


class SuggestInterventionsView(AuthenticatedAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [JSONParser]

    def post(self, request: HttpRequest) -> Response:
        if not AI_SUGGESTIONS_ENABLED:
            return Response({"detail": "Sugerencias de IA deshabilitadas"}, status=404)

        try:
            ctx = ClinicalContext.model_validate(request.data)
            payload = async_to_sync(generate_intervention_suggestions)(ctx)
        except ValueError:
            return Response({"detail": "Formato de respuesta de IA inesperado"}, status=502)
        except Exception:
            return Response({"detail": "Error al generar sugerencias con IA"}, status=502)

        return Response(payload.model_dump(), status=200)


class AudioToFHIRView(AuthenticatedAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: HttpRequest) -> Response:
        upload = request.FILES.get("file")
        patient_id = request.data.get("patientId")
        label = request.data.get("label") or "Handover Audio"
        encounter_ref = request.data.get("encounterRef")

        if not upload or not patient_id:
            return Response({"detail": "patientId y file son obligatorios"}, status=400)

        b64 = base64.b64encode(upload.read()).decode("utf-8")
        now = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
        doc = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {"text": label},
            "subject": {"reference": f"Patient/{patient_id}"},
            "date": now,
            **({"context": {"encounter": [{"reference": encounter_ref}]}} if encounter_ref else {}),
            "content": [{"attachment": {"contentType": upload.content_type or "audio/mpeg", "data": b64, "title": upload.name}}],
        }

        try:
            resp = httpx.post(
                f"{FHIR_BASE.rstrip('/')}/DocumentReference",
                json=doc,
                headers=get_fhir_headers(request),
                timeout=60,
            )
        except httpx.HTTPError:
            return Response({"detail": "No se pudo contactar el servidor FHIR"}, status=503)

        if resp.status_code >= 400:
            return Response({"detail": resp.text}, status=resp.status_code)

        try:
            return Response(resp.json(), status=resp.status_code)
        except Exception:
            return Response({"detail": "Respuesta del servidor FHIR no es JSON"}, status=502)
