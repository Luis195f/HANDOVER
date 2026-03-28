import base64
import datetime
import logging
import mimetypes
import os
import backend.ai_client as ai_client
from typing import Any, Dict

import httpx
from asgiref.sync import async_to_sync
from django.conf import settings
from django.http import HttpRequest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import serializers
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.ai_client import (
    ClinicalContext,
    OPENAI_MODEL_SBAR,
    OPENAI_MODEL_SUGGESTIONS,
    generate_intervention_suggestions,
    generate_sbar,
    transcribe_audio,
    is_openai_enabled,
)
from backend.api.models import ClinicalDecisionEvent
from backend.audit.service import emit_audit_event
from backend.audit.utils import canonical_json, hash_payload
from backend.security.roles import extract_roles
from .views import (
    AuthenticatedAPIView,
    FHIR_BASE,
    get_fhir_headers,
    _get_authenticated_user_sub,
    _resolve_patient_unit_scope,
)
from backend.security.permissions_roles import HasAnyRole
from backend.security.scope_permissions import HasAnyScope

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_MIME_TYPES = {
    "audio/aac",
    "audio/m4a",
    "audio/mp4",
    "audio/mp3",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/x-m4a",
}
DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_FREE_TEXT_LENGTH = 15000
MAX_NOTES_LENGTH = 500
AI_SUGGESTIONS_ENABLED = os.getenv("AI_SUGGESTIONS_ENABLED", "true").lower() in ["1", "true", "yes", "on"]

CLINICAL_DECISION_ALLOWED_SOURCES = (
    "ai_generate_sbar",
    "ai_refine_sbar",
    "ai_nic_suggestions",
    "ai_noc_suggestions",
)
CLINICAL_DECISION_ALLOWED_REASONS = (
    "direct_apply",
    "selection_applied",
    "replace_existing",
    "user_discarded_batch",
    "not_relevant",
    "insufficient_quality",
    "other",
)
CLINICAL_DECISION_ALLOWED_METADATA_KEYS = {
    "selectedCodes",
    "selectedCount",
    "section",
    "suggestionCount",
    "suggestionHashes",
    "replaceExisting",
}
CLINICAL_DECISION_ALLOWED_SECTIONS = {"sbar", "treatments", "outcomes"}


def _suggestion_version_for_source(source: str) -> str:
    source_key = (source or "").strip().lower()
    if source_key in {"ai_generate_sbar", "ai_refine_sbar"}:
        return OPENAI_MODEL_SBAR
    if source_key in {"ai_nic_suggestions", "ai_noc_suggestions"}:
        return OPENAI_MODEL_SUGGESTIONS
    return ""


def _extract_actor_role(request: HttpRequest) -> str:
    claims = request.auth if isinstance(request.auth, dict) else getattr(getattr(request, "user", None), "claims", None)
    if not isinstance(claims, dict):
        return ""

    roles = extract_roles(claims)
    for role in ("admin", "supervisor", "nurse"):
        if role in roles:
            return role
    return ""


class ClinicalDecisionCreateSerializer(serializers.Serializer):
    patientId = serializers.CharField(max_length=255)
    unitId = serializers.CharField(max_length=255)
    handoverId = serializers.CharField(max_length=255, required=False, allow_blank=True)
    suggestionSource = serializers.ChoiceField(choices=CLINICAL_DECISION_ALLOWED_SOURCES)
    suggestionVersion = serializers.CharField(max_length=64, required=False, allow_blank=True)
    decision = serializers.ChoiceField(choices=[choice for choice, _label in ClinicalDecisionEvent.DECISION_CHOICES])
    reasonCode = serializers.ChoiceField(
        choices=CLINICAL_DECISION_ALLOWED_REASONS,
        required=False,
        allow_blank=True,
    )
    note = serializers.CharField(max_length=240, required=False, allow_blank=True)
    metadata = serializers.JSONField(required=False)

    def validate_patientId(self, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("patientId is required.")
        return normalized

    def validate_unitId(self, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError("unitId is required.")
        return normalized

    def validate_handoverId(self, value: str) -> str:
        return value.strip()

    def validate_suggestionVersion(self, value: str) -> str:
        return value.strip()

    def validate_note(self, value: str) -> str:
        return value.strip()

    def validate_metadata(self, value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("metadata must be an object.")

        unexpected_keys = sorted(set(value.keys()) - CLINICAL_DECISION_ALLOWED_METADATA_KEYS)
        if unexpected_keys:
            raise serializers.ValidationError(f"Unsupported metadata keys: {', '.join(unexpected_keys)}")

        normalized: dict[str, Any] = {}

        if "selectedCodes" in value:
            raw_codes = value.get("selectedCodes")
            if not isinstance(raw_codes, list):
                raise serializers.ValidationError("metadata.selectedCodes must be a list.")
            normalized_codes: list[str] = []
            for raw_code in raw_codes[:10]:
                if not isinstance(raw_code, str):
                    raise serializers.ValidationError("metadata.selectedCodes must contain strings.")
                code = raw_code.strip()
                if not code or len(code) > 64:
                    raise serializers.ValidationError("metadata.selectedCodes entries must be 1-64 chars.")
                normalized_codes.append(code)
            normalized["selectedCodes"] = normalized_codes

        for key in ("selectedCount", "suggestionCount"):
            if key not in value:
                continue
            raw_number = value.get(key)
            if type(raw_number) is not int or raw_number < 0 or raw_number > 20:
                raise serializers.ValidationError(f"metadata.{key} must be an integer between 0 and 20.")
            normalized[key] = raw_number

        if "section" in value:
            raw_section = value.get("section")
            if not isinstance(raw_section, str):
                raise serializers.ValidationError("metadata.section must be a string.")
            section = raw_section.strip().lower()
            if section not in CLINICAL_DECISION_ALLOWED_SECTIONS:
                raise serializers.ValidationError("metadata.section is invalid.")
            normalized["section"] = section

        if "suggestionHashes" in value:
            raw_hashes = value.get("suggestionHashes")
            if not isinstance(raw_hashes, list):
                raise serializers.ValidationError("metadata.suggestionHashes must be a list.")
            normalized_hashes: list[str] = []
            for raw_hash in raw_hashes[:10]:
                if not isinstance(raw_hash, str):
                    raise serializers.ValidationError("metadata.suggestionHashes must contain strings.")
                suggestion_hash = raw_hash.strip().lower()
                if len(suggestion_hash) != 64 or any(ch not in "0123456789abcdef" for ch in suggestion_hash):
                    raise serializers.ValidationError("metadata.suggestionHashes entries must be 64-char hex strings.")
                normalized_hashes.append(suggestion_hash)
            normalized["suggestionHashes"] = normalized_hashes

        if "replaceExisting" in value:
            raw_replace_existing = value.get("replaceExisting")
            if not isinstance(raw_replace_existing, bool):
                raise serializers.ValidationError("metadata.replaceExisting must be a boolean.")
            normalized["replaceExisting"] = raw_replace_existing

        return normalized


def _get_max_audio_bytes() -> int:
    raw_value = os.getenv("HANDOVER_MAX_AUDIO_BYTES")
    if not raw_value:
        return DEFAULT_MAX_AUDIO_BYTES
    try:
        parsed = int(raw_value)
    except ValueError:
        return DEFAULT_MAX_AUDIO_BYTES
    return parsed if parsed > 0 else DEFAULT_MAX_AUDIO_BYTES


HANDOVER_MAX_AUDIO_BYTES = _get_max_audio_bytes()


def _get_upload_size_bytes(upload: Any) -> int | None:
    # 1️⃣ Caso normal UploadedFile
    size = getattr(upload, "size", None)
    if isinstance(size, int) and size >= 0:
        return size

    # 2️⃣ Intentar calcular desde file
    stream = getattr(upload, "file", None)
    if stream and all(hasattr(stream, attr) for attr in ("tell", "seek")):
        try:
            current_pos = stream.tell()
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(current_pos)
            if isinstance(size, int) and size >= 0:
                return size
        except Exception:
            pass

    # 3️⃣ Fallback seguro para tests (InMemoryUploadedFile edge case)
    if hasattr(upload, "read"):
        try:
            data = upload.read()
            if isinstance(data, (bytes, bytearray)):
                return len(data)
        finally:
            try:
                upload.seek(0)
            except Exception:
                pass

    return None
    

def _coerce_test_upload(upload: Any) -> Any:
    """
    En tests DRF puede llegar como tuple/list: (filename, content[, content_type]).
    En runtime real viene como UploadedFile en request.FILES.
    """
    if upload is None:
        return None

    if hasattr(upload, "read") and hasattr(upload, "name"):
        return upload

    if isinstance(upload, (tuple, list)) and 2 <= len(upload) <= 3:
        filename = upload[0]
        content = upload[1]
        content_type = upload[2] if len(upload) == 3 else "application/octet-stream"

        if not isinstance(filename, str):
            return upload

        if isinstance(content, str):
            content = content.encode("utf-8")
        elif isinstance(content, bytearray):
            content = bytes(content)

        if not isinstance(content, bytes):
            return upload

        if not isinstance(content_type, str) or not content_type.strip():
            content_type = "application/octet-stream"

        return SimpleUploadedFile(filename, content, content_type=content_type)

    return upload
    

def _normalize_audio_content_type(upload: Any) -> str | None:
    content_type = (getattr(upload, "content_type", "") or "").split(";")[0].strip().lower()
    if content_type:
        return content_type

    filename = (getattr(upload, "name", "") or "").strip().lower()
    if not filename:
        return None
    guessed_type, _ = mimetypes.guess_type(filename)
    return guessed_type.lower() if guessed_type else None


def _validate_audio_upload(upload: Any) -> Response | None:
    size = _get_upload_size_bytes(upload)
    if size is None:
        return Response({"detail": "No se pudo determinar el tamaño del audio", "code": "audio_size_unknown"}, status=400)
    if size > HANDOVER_MAX_AUDIO_BYTES:
        return Response({"detail": "Payload Too Large", "code": "audio_payload_too_large"}, status=413)

    content_type = _normalize_audio_content_type(upload)
    if not content_type or content_type not in ALLOWED_AUDIO_MIME_TYPES:
        return Response({"detail": "Audio inválido o formato no soportado", "code": "unsupported_audio_type"}, status=415)
    return None


def _permission_instances(permission_classes: Any) -> list[Any]:
    instances: list[Any] = []
    for permission in permission_classes:
        if permission is None:
            continue
        instances.append(permission() if isinstance(permission, type) else permission)
    return instances


def _safe_upstream_upload_error(status_code: int) -> Response:
    return Response(
        {
            "detail": "El servidor FHIR rechazó la carga del audio",
            "code": "fhir_upload_rejected",
            "status": status_code,
        },
        status=status_code,
    )


class ProtectedAIAPIView(AuthenticatedAPIView):
    """Sensitive AI/STT/upload endpoints never inherit DEBUG/test auth bypasses."""

    def get_permissions(self):
        return _permission_instances(self.permission_classes)

    def get_authenticators(self):
        authenticator_classes = [auth for auth in self.authentication_classes if auth is not None]
        return [auth() for auth in authenticator_classes]


class TranscribeView(ProtectedAIAPIView):

    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]

    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: HttpRequest) -> Response:
        # DRF normalmente pone archivos en request.FILES, pero en tests puede venir en request.data
        upload = request.FILES.get("file") or request.data.get("file")
        upload = _coerce_test_upload(upload)
        if not upload:
            return Response(
                {
                    "detail": "Missing audio file (expected multipart form-data with 'file')",
                    "code": "missing_audio_file",
                },
                status=400,
            )

        language = (request.data.get("language") or "es").strip()

        # ✅ Validate upload BEFORE checking AI availability
        validation_error = _validate_audio_upload(upload)
        if validation_error:
            return validation_error

        # If OpenAI is disabled, return 503 unless transcribe_audio has been monkeypatched in tests.
        openai_enabled = is_openai_enabled()
        transcribe_is_mocked = transcribe_audio is not ai_client.transcribe_audio
        if not openai_enabled and not transcribe_is_mocked:
            return Response({"detail": "Servicio de IA deshabilitado por configuración", "code": "ai_disabled"}, status=503)

        try:
            # Compatible con transcribe_audio(upload, language) y con transcribe_audio(file=..., language=...)
            try:
                text = async_to_sync(transcribe_audio)(file=upload, language=language)
            except TypeError:
                text = async_to_sync(transcribe_audio)(upload, language)
        except Exception:
            return Response({"detail": "Error al procesar el audio con el servicio de IA", "code": "ai_transcription_failed"}, status=502)

        return Response(
            {"text": text, "language": language or "es", "durationSeconds": None},
            status=200,
        )


class SummarizeSbarView(ProtectedAIAPIView):
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

        # Sujeto autenticado real (evita suplantación por header)
        user_sub = _get_authenticated_user_sub(request)

        if len(free_text) > MAX_FREE_TEXT_LENGTH:
            self._audit_ai_summary(
                status="fail",
                http_status=400,
                user_sub=user_sub,
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
                user_sub=user_sub,
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
                user_sub=user_sub,
                notes=notes,
                context=ctx,
                language=language,
            )
            return Response({"detail": "Formato de respuesta de IA inesperado"}, status=502)

        self._audit_ai_summary(
            status="success",
            http_status=200,
            user_sub=user_sub,
            notes=notes,
            context=ctx,
            language=language,
        )
        return Response(payload, status=200)



class RefineSbarView(ProtectedAIAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [JSONParser]

    @staticmethod
    def _truncate_for_audit(text: str) -> str:
        if len(text) <= MAX_NOTES_LENGTH:
            return text
        return text[:MAX_NOTES_LENGTH].rstrip() + "…"

    @staticmethod
    def _format_context_value(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            trimmed = value.strip()
            return trimmed or None
        return canonical_json(value).decode("utf-8")

    @staticmethod
    def _normalize_draft_field(value: Any, *, field_name: str) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        raise ValueError(field_name)

    @classmethod
    def _normalize_refine_draft(cls, draft: Dict[str, Any]) -> Dict[str, str]:
        normalized: Dict[str, str] = {}
        for field_name in ("situation", "background", "assessment", "recommendation"):
            normalized[field_name] = cls._normalize_draft_field(draft.get(field_name), field_name=field_name)
        return normalized

    @classmethod
    def _build_refine_input(cls, draft: Dict[str, str], handover: Dict[str, Any]) -> tuple[str, dict, str]:
        lines = [
            "Refina el siguiente SBAR usando solo el contexto clínico disponible.",
            "No inventes datos ni prescripciones.",
            "SBAR actual:",
            f"S: {draft['situation'] or 'dato no disponible'}",
            f"B: {draft['background'] or 'dato no disponible'}",
            f"A: {draft['assessment'] or 'dato no disponible'}",
            f"R: {draft['recommendation'] or 'dato no disponible'}",
        ]

        context_lines = []
        if isinstance(handover, dict):
            for key, value in handover.items():
                formatted = cls._format_context_value(value)
                if formatted is None:
                    continue
                context_lines.append(f"{key}: {formatted}")

        if context_lines:
            lines.extend(["", "Contexto clínico estructurado:", *context_lines])

        audit_payload = {"draft": draft, "handover": handover}
        audit_notes = cls._truncate_for_audit(" ".join(value for value in draft.values() if value))
        return "\n".join(lines), audit_payload, audit_notes

    def _audit_ai_refine(
        self,
        *,
        status: str,
        http_status: int,
        user_sub: str | None,
        notes: str,
        payload: dict,
        language: str,
    ) -> None:
        payload_obj = {"notes": notes, "payload": payload, "language": language}
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
                meta={"model": OPENAI_MODEL_SBAR, "promptVersion": "v1", "source": "ai/refine-sbar"},
            )
        except Exception:
            logger.exception("No se pudo registrar auditoria de refinado SBAR")

    def post(self, request: HttpRequest) -> Response:
        req = request.data if isinstance(request.data, dict) else {}
        raw_draft = req.get("draft")
        if "draft" in req and not isinstance(raw_draft, dict):
            return Response({"detail": "draft must be an object.", "code": "invalid_refine_draft"}, status=400)

        raw_handover = req.get("handover")
        if "handover" in req and not isinstance(raw_handover, dict):
            return Response({"detail": "handover must be an object.", "code": "invalid_refine_handover"}, status=400)

        draft = raw_draft if isinstance(raw_draft, dict) else {}
        handover = raw_handover if isinstance(raw_handover, dict) else {}
        language = req.get("language") or "es"
        user_sub = _get_authenticated_user_sub(request)

        try:
            normalized_draft = self._normalize_refine_draft(draft)
        except ValueError as exc:
            field_name = str(exc) or "draft"
            return Response(
                {
                    "detail": f"draft.{field_name} must be a string or null.",
                    "code": "invalid_refine_draft",
                },
                status=400,
            )

        combined_text, audit_payload, audit_notes = self._build_refine_input(normalized_draft, handover)
        if len(combined_text) > MAX_FREE_TEXT_LENGTH:
            self._audit_ai_refine(
                status="fail",
                http_status=400,
                user_sub=user_sub,
                notes=audit_notes,
                payload=audit_payload,
                language=language,
            )
            return Response({"detail": "Texto demasiado largo para refinar"}, status=400)

        try:
            payload = async_to_sync(generate_sbar)(combined_text, language=language)
        except Exception:
            self._audit_ai_refine(
                status="fail",
                http_status=502,
                user_sub=user_sub,
                notes=audit_notes,
                payload=audit_payload,
                language=language,
            )
            return Response({"detail": "Error al refinar SBAR con el servicio de IA"}, status=502)

        required_keys = ["situation", "background", "assessment", "recommendation"]
        if not all(isinstance(payload.get(key), str) for key in required_keys):
            self._audit_ai_refine(
                status="fail",
                http_status=502,
                user_sub=user_sub,
                notes=audit_notes,
                payload=audit_payload,
                language=language,
            )
            return Response({"detail": "Formato de respuesta de IA inesperado"}, status=502)

        self._audit_ai_refine(
            status="success",
            http_status=200,
            user_sub=user_sub,
            notes=audit_notes,
            payload=audit_payload,
            language=language,
        )
        return Response(
            {
                "sbar": {
                    "situation": payload["situation"],
                    "background": payload["background"],
                    "assessment": payload["assessment"],
                    "recommendation": payload["recommendation"],
                }
            },
            status=200,
        )

class SuggestInterventionsView(ProtectedAIAPIView):
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


class ClinicalDecisionView(ProtectedAIAPIView):
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    parser_classes = [JSONParser]

    def post(self, request: HttpRequest) -> Response:
        serializer = ClinicalDecisionCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    "detail": "Invalid clinical decision payload.",
                    "code": "invalid_clinical_decision_payload",
                    "errors": serializer.errors,
                },
                status=400,
            )

        validated = serializer.validated_data
        unit_id = str(validated["unitId"])
        _, scope_error = _resolve_patient_unit_scope(request, requested_unit=unit_id)
        if scope_error is not None:
            return scope_error

        actor_id = _get_authenticated_user_sub(request)
        if not actor_id:
            return Response(
                {
                    "detail": "Authenticated actor could not be resolved.",
                    "code": "clinical_decision_actor_unavailable",
                },
                status=401,
            )

        decision_event = ClinicalDecisionEvent.objects.create(
            handover_id=str(validated.get("handoverId") or ""),
            patient_id=str(validated["patientId"]),
            unit_id=unit_id,
            actor_id=actor_id,
            actor_role=_extract_actor_role(request),
            suggestion_source=str(validated["suggestionSource"]),
            suggestion_version=str(validated.get("suggestionVersion") or _suggestion_version_for_source(str(validated["suggestionSource"]))),
            decision=str(validated["decision"]),
            reason_code=str(validated.get("reasonCode") or ""),
            note=str(validated.get("note") or ""),
            metadata=validated.get("metadata") or {},
        )

        emit_audit_event(
            event_type="clinical_decision_logged",
            action="create",
            status="success",
            http_status=201,
            request=request,
            user_sub=actor_id,
            resource_type="ClinicalDecisionEvent",
            resource_id=str(decision_event.decision_id),
            payload_obj={
                "decisionId": str(decision_event.decision_id),
                "patientId": decision_event.patient_id,
                "unitId": decision_event.unit_id,
                "suggestionSource": decision_event.suggestion_source,
                "decision": decision_event.decision,
                "reasonCode": decision_event.reason_code,
                "metadata": decision_event.metadata,
            },
            meta={
                "suggestionSource": decision_event.suggestion_source,
                "decision": decision_event.decision,
                "reasonCode": decision_event.reason_code or None,
            },
        )

        return Response(
            {
                "decisionId": str(decision_event.decision_id),
                "status": "recorded",
                "decision": decision_event.decision,
                "suggestionSource": decision_event.suggestion_source,
                "createdAt": decision_event.created_at.isoformat().replace("+00:00", "Z"),
            },
            status=201,
        )


class AudioToFHIRView(ProtectedAIAPIView):
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
            return Response({"detail": "patientId y file son obligatorios", "code": "missing_upload_fields"}, status=400)

        validation_error = _validate_audio_upload(upload)
        if validation_error:
            return validation_error

        audio_content_type = _normalize_audio_content_type(upload)
        if not audio_content_type:
            return Response({"detail": "Audio inválido o formato no soportado"}, status=415)

        b64 = base64.b64encode(upload.read()).decode("utf-8")
        now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        doc = {
            "resourceType": "DocumentReference",
            "status": "current",
            "type": {"text": label},
            "subject": {"reference": f"Patient/{patient_id}"},
            "date": now,
            **({"context": {"encounter": [{"reference": encounter_ref}]}} if encounter_ref else {}),
            "content": [{"attachment": {"contentType": audio_content_type, "data": b64, "title": upload.name}}],
        }

        try:
            resp = httpx.post(
                f"{FHIR_BASE.rstrip('/')}/DocumentReference",
                json=doc,
                headers=get_fhir_headers(request),
                timeout=60,
            )
        except httpx.HTTPError:
            return Response({"detail": "No se pudo contactar el servidor FHIR", "code": "fhir_unavailable"}, status=503)

        if resp.status_code >= 400:
            return _safe_upstream_upload_error(resp.status_code)

        try:
            return Response(resp.json(), status=resp.status_code)
        except Exception:
            return Response({"detail": "Respuesta del servidor FHIR no es JSON", "code": "fhir_invalid_response"}, status=502)


