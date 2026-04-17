# backend/ai_client.py
import io
import json
import logging
import os
import asyncio
import re
from typing import Any, Dict, Optional

from openai import OpenAI
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

OPENAI_MODEL_SBAR = os.getenv("OPENAI_MODEL_SBAR", "gpt-4.1-mini")
OPENAI_MODEL_WHISPER = os.getenv("OPENAI_MODEL_WHISPER", "whisper-1")
OPENAI_MODEL_SUGGESTIONS = os.getenv("OPENAI_MODEL_SUGGESTIONS", OPENAI_MODEL_SBAR)

ASYNC_TRANSCRIPTION_TIMEOUT = 60
ASYNC_SBAR_TIMEOUT = 120
ASYNC_SUGGESTIONS_TIMEOUT = 90

_client: Optional[OpenAI] = None


def _env_flag_enabled(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_openai_enabled() -> bool:
    ai_enabled = _env_flag_enabled("HANDOVER_AI_ENABLED", True)
    openai_disabled = _env_flag_enabled("HANDOVER_OPENAI_DISABLED", False)
    return ai_enabled and not openai_disabled


def get_client() -> OpenAI:
    """
    Lazy init: evita crear el cliente OpenAI al importar el módulo (rompe tests si no hay OPENAI_API_KEY).
    """
    global _client
    if _client is not None:
        return _client

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    # Reject placeholder / dummy keys (tests rely on this behavior)
    placeholder_values = {"dummy", "test", "changeme", "placeholder", "sk-your-key", "sk_test"}
    normalized = api_key.strip().lower()
    if normalized in placeholder_values or normalized.startswith("dummy"):
        raise RuntimeError("OPENAI_API_KEY is a placeholder value; please set a real key")

    if not is_openai_enabled():
        raise RuntimeError("OpenAI client is disabled by environment flags")

    _client = OpenAI(api_key=api_key)
    return _client


class ClinicalContext(BaseModel):
    language: str = "es"
    section: str
    unitId: str | None = None
    patient_age: int | None = None
    vital_signs: dict | None = None
    scores: dict | None = None
    diagnoses: list[str] | None = None
    devices: list[str] | None = None
    notes: str | None = None


class NocOutcomeSuggestion(BaseModel):
    nocCode: str
    nocDisplay: str
    baseline: int = Field(ge=1, le=5)
    target: int = Field(ge=1, le=5)
    current: int | None = Field(default=None, ge=1, le=5)


class SuggestionsResponse(BaseModel):
    interventions: list[str]
    outcomes: list[NocOutcomeSuggestion] | None = None
    rationale: str | None = None
    section: str

def _safe_length(value: Optional[str] | bytes) -> int:
    if value is None:
        return 0
    if isinstance(value, bytes):
        return len(value)
    return len(value)


async def _run_blocking(func: Any, /, *args: Any, **kwargs: Any) -> Any:
    return await asyncio.to_thread(func, *args, **kwargs)


async def transcribe_audio(file: Any, language: Optional[str]) -> str:
    data: bytes | None = None
    try:
        raw = file.read()
        data = await raw if asyncio.iscoroutine(raw) else raw
        size_bytes = len(data or b"")
        if not data:
            raise ValueError("empty-audio")

        audio_buffer = io.BytesIO(data)
        audio_buffer.name = (getattr(file, "name", None) or "audio.m4a")

        logger.info("[ai] transcribe start size_bytes=%s", size_bytes)
        client = get_client()
        response = await _run_blocking(
            client.audio.transcriptions.create,
            model=OPENAI_MODEL_WHISPER,
            file=audio_buffer,
            language=language,
            timeout=ASYNC_TRANSCRIPTION_TIMEOUT,
        )
        text = getattr(response, "text", None)
        if not isinstance(text, str):
            raise RuntimeError("missing-text")
        return text.strip()
    except Exception as exc:  # pragma: no cover - logged for observability
        logger.exception(
            "[ai] transcribe failed size_bytes=%s error_type=%s",
            _safe_length(data),
            type(exc).__name__,
        )
        raise


def build_sbar_prompt(text: str, language: str) -> str:
    return (
        "Eres una enfermera clínica experta en un hospital de España.\n"
        "A partir de los datos estructurados y notas breves, resume en formato SBAR"
        " (Situation, Background, Assessment, Recommendation) en español profesional,"
        " claro y conciso, sin inventar datos que no estén presentes.\n"
        "Incluye datos clínicos relevantes como signos vitales, escalas, dispositivos, medicaciones"
        " y riesgos si aparecen en el contexto.\n"
        "Si falta un dato, indica explícitamente \"dato no disponible\".\n"
        "No hagas diagnósticos médicos nuevos ni órdenes médicas.\n"
        "No incluyas dosis, pautas ni recomendaciones terapéuticas específicas.\n"
        "Incluye una advertencia de seguridad: \"Asistente de apoyo, no diagnóstico ni prescripción\""
        " dentro de full_text.\n"
        "Devuelve un objeto JSON con las claves situation, background, assessment, recommendation y full_text."
        f"\nIdioma de salida: {language}.\n"
        f"Contexto:\n{text}"
    )


async def generate_sbar(text: str, language: str = "es") -> Dict[str, str]:
    try:
        logger.info("[ai] sbar start length=%s language=%s", len(text), language)
        client = get_client()
        completion = await _run_blocking(
            client.chat.completions.create,
            model=OPENAI_MODEL_SBAR,
            messages=[
                {"role": "system", "content": "Asistente de enfermería"},
                {"role": "user", "content": build_sbar_prompt(text, language)},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            timeout=ASYNC_SBAR_TIMEOUT,
        )
        choice = completion.choices[0].message if completion.choices else None
        content = choice.content if choice else None
        if not content:
            raise RuntimeError("empty-response")

        payload = json.loads(content)
        expected_keys = ["situation", "background", "assessment", "recommendation"]
        if not all(isinstance(payload.get(key), str) for key in expected_keys):
            raise RuntimeError("invalid-keys")

        full_text = payload.get("full_text")
        warning = "Asistente de apoyo, no diagnóstico ni prescripción."
        final_full_text = full_text if isinstance(full_text, str) else ""
        if warning.lower() not in final_full_text.lower():
            final_full_text = (final_full_text + "\n\n" if final_full_text else "") + warning
        return {
            "situation": payload.get("situation", ""),
            "background": payload.get("background", ""),
            "assessment": payload.get("assessment", ""),
            "recommendation": payload.get("recommendation", ""),
            "full_text": final_full_text,
        }
    except Exception as exc:  # pragma: no cover - logged for observability
        logger.exception("[ai] sbar failed length=%s error_type=%s", len(text), type(exc).__name__)
        raise


def _build_suggestions_prompt(ctx: ClinicalContext) -> str:
    context_json = json.dumps(ctx.model_dump(exclude_none=True), ensure_ascii=False)
    if ctx.section == "outcomes":
        return (
            "Eres una enfermera clínica experta en un hospital de España. Te doy contexto "
            "estructurado de un paciente (signos vitales, diagnósticos, escalas de riesgo).\n"
            "A partir de estos datos, sugiere entre 1 y 3 resultados esperados NOC para captura rápida.\n"
            "Cada resultado debe incluir: nocCode, nocDisplay, baseline (1-5), target (1-5) y current (1-5 opcional).\n"
            "NO inventes datos que no estén en el contexto.\n"
            "No des diagnóstico médico ni prescribas medicación nueva.\n"
            "Responde en JSON con: outcomes (lista de objetos), interventions (lista corta de strings, 1-3) "
            "y rationale (explicación breve).\n"
            f"Idioma de salida: {ctx.language}.\n"
            f"Contexto: {context_json}"
        )

    return (
        "Eres una enfermera clínica experta en un hospital de España. Te doy contexto "
        "estructurado de un paciente (signos vitales, diagnósticos, escalas de riesgo).\n"
        "A partir de estos datos, sugiere entre 3 y 6 intervenciones de enfermería concretas,"
        " accionables y alineadas con prácticas clínicas estándar.\n"
        "NO inventes datos que no estén en el contexto.\n"
        "No des diagnóstico médico ni prescribas medicación nueva.\n"
        "Responde en formato JSON con: interventions (lista de strings) y rationale "
        "(explicación breve en un párrafo).\n"
        f"Idioma de salida: {ctx.language}.\n"
        f"Contexto: {context_json}"
    )


def _normalize_interventions(raw_payload: Any) -> list[str]:
    if not isinstance(raw_payload, list):
        return []

    interventions: list[str] = []
    for item in raw_payload:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if not trimmed:
            continue
        interventions.append(trimmed)

    return interventions


def _normalize_outcomes(raw_payload: Any) -> list[NocOutcomeSuggestion]:
    if not isinstance(raw_payload, list):
        return []

    outcomes: list[NocOutcomeSuggestion] = []
    for item in raw_payload:
        if not isinstance(item, dict):
            continue

        try:
            parsed = NocOutcomeSuggestion.model_validate(item)
        except Exception:
            continue

        if not str(parsed.nocCode).strip() or not str(parsed.nocDisplay).strip():
            continue

        outcomes.append(
            NocOutcomeSuggestion(
                nocCode=str(parsed.nocCode).strip(),
                nocDisplay=str(parsed.nocDisplay).strip(),
                baseline=parsed.baseline,
                target=parsed.target,
                current=parsed.current,
            )
        )

    return outcomes


def _fallback_outcomes_from_interventions(interventions: list[str]) -> list[NocOutcomeSuggestion]:
    outcomes: list[NocOutcomeSuggestion] = []

    for idx, raw in enumerate(interventions):
        normalized = raw.strip()
        if not normalized:
            continue

        match = re.search(r"\bNOC\s*[-:#]?\s*([A-Za-z0-9.]+)\s*[:\-]?\s*(.+)$", normalized, re.IGNORECASE)
        noc_code = (match.group(1).strip() if match else f"NOC-{idx + 1}")
        noc_display = (match.group(2).strip() if match else normalized)
        if not noc_display:
            continue

        outcomes.append(
            NocOutcomeSuggestion(
                nocCode=noc_code,
                nocDisplay=noc_display,
                baseline=2,
                target=4,
                current=None,
            )
        )

    return outcomes


async def generate_intervention_suggestions(ctx: ClinicalContext) -> SuggestionsResponse:
    try:
        logger.info("[ai] suggestions start section=%s", ctx.section)
        client = get_client()
        completion = await _run_blocking(
            client.chat.completions.create,
            model=OPENAI_MODEL_SUGGESTIONS,
            messages=[
                {"role": "system", "content": "Asistente de apoyo a la decisión clínica"},
                {"role": "user", "content": _build_suggestions_prompt(ctx)},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            timeout=ASYNC_SUGGESTIONS_TIMEOUT,
        )
        choice = completion.choices[0].message if completion.choices else None
        content = choice.content if choice else None
        if not content:
            raise RuntimeError("empty-response")

        payload = json.loads(content)
        interventions = _normalize_interventions(payload.get("interventions"))
        rationale = payload.get("rationale") if isinstance(payload.get("rationale"), str) else None

        if ctx.section == "outcomes":
            outcomes = _normalize_outcomes(payload.get("outcomes"))
            if len(outcomes) == 0:
                outcomes = _fallback_outcomes_from_interventions(interventions)
            if len(outcomes) == 0:
                raise ValueError("empty-outcomes")

            outcomes = outcomes[:3]
            if len(interventions) == 0:
                interventions = [f"NOC {item.nocCode}: {item.nocDisplay}" for item in outcomes]

            return SuggestionsResponse(
                interventions=interventions[:3],
                outcomes=outcomes,
                rationale=rationale,
                section=ctx.section,
            )

        if len(interventions) == 0:
            raise ValueError("empty-interventions")

        return SuggestionsResponse(interventions=interventions, rationale=rationale, section=ctx.section)
    except ValueError:
        raise
    except Exception as exc:  # pragma: no cover - logged for observability
        logger.exception("[ai] suggestions failed section=%s error_type=%s", ctx.section, type(exc).__name__)
        raise

