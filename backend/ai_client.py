import io
import json
import logging
import os
from typing import Dict, Optional

from fastapi import UploadFile
from openai import OpenAI

logger = logging.getLogger(__name__)

OPENAI_MODEL_SBAR = os.getenv("OPENAI_MODEL_SBAR", "gpt-4.1-mini")
OPENAI_MODEL_WHISPER = os.getenv("OPENAI_MODEL_WHISPER", "whisper-1")

client = OpenAI()

ASYNC_TRANSCRIPTION_TIMEOUT = 60
ASYNC_SBAR_TIMEOUT = 120


def _safe_length(value: Optional[str] | bytes) -> int:
    if value is None:
        return 0
    if isinstance(value, bytes):
        return len(value)
    return len(value)


async def transcribe_audio(file: UploadFile, language: Optional[str]) -> str:
    data: bytes | None = None
    try:
        data = await file.read()
        size_bytes = len(data or b"")
        if not data:
            raise ValueError("empty-audio")

        audio_buffer = io.BytesIO(data)
        audio_buffer.name = file.filename or "audio.m4a"

        logger.info("[ai] transcribe start size_bytes=%s", size_bytes)
        response = client.audio.transcriptions.create(
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


def _build_sbar_prompt(text: str, language: str) -> str:
    return (
        "Eres una enfermera clínica experta en un hospital de España.\n"
        "A partir del siguiente texto de notas de enfermería, resume en formato SBAR"
        " (Situation, Background, Assessment, Recommendation) en español profesional,"
        " claro y conciso, sin inventar datos que no estén presentes.\n"
        "Incluye datos clínicos relevantes como signos vitales, escalas, dispositivos, medicaciones"
        " y riesgos si aparecen en el texto.\n"
        "No hagas diagnósticos médicos nuevos ni órdenes médicas.\n"
        "Devuelve un objeto JSON con las claves situation, background, assessment, recommendation y full_text."
        f"\nIdioma de salida: {language}.\n"
        f"Notas:\n{text}"
    )


async def generate_sbar(text: str, language: str = "es") -> Dict[str, str]:
    try:
        logger.info("[ai] sbar start length=%s language=%s", len(text), language)
        completion = client.chat.completions.create(
            model=OPENAI_MODEL_SBAR,
            messages=[
                {"role": "system", "content": "Asistente de enfermería"},
                {"role": "user", "content": _build_sbar_prompt(text, language)},
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
        return {
            "situation": payload.get("situation", ""),
            "background": payload.get("background", ""),
            "assessment": payload.get("assessment", ""),
            "recommendation": payload.get("recommendation", ""),
            "full_text": full_text if isinstance(full_text, str) else "",
        }
    except Exception as exc:  # pragma: no cover - logged for observability
        logger.exception("[ai] sbar failed length=%s error_type=%s", len(text), type(exc).__name__)
        raise
