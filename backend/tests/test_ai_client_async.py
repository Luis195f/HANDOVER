import asyncio
import importlib
import io
import sys
from types import SimpleNamespace

import pytest


class UploadFile:
    def __init__(self, *, filename: str, file, content_type: str = "audio/m4a"):
        self.filename = filename
        self.file = file
        self.content_type = content_type

    def read(self):
        return self.file.read()



def test_module_import_does_not_initialize_client_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    import openai

    def _boom(*args, **kwargs):
        raise AssertionError("OpenAI client should not be initialized on module import")

    monkeypatch.setattr(openai, "OpenAI", _boom)
    sys.modules.pop("backend.ai_client", None)

    module = importlib.import_module("backend.ai_client")

    assert module._client is None
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY is not set"):
        module.get_client()





def test_get_client_respects_ai_flags(monkeypatch):
    from backend import ai_client

    monkeypatch.setattr(ai_client, "_client", None, raising=False)
    monkeypatch.setenv("HANDOVER_AI_ENABLED", "0")
    monkeypatch.delenv("HANDOVER_OPENAI_DISABLED", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    with pytest.raises(RuntimeError, match="disabled by environment flags"):
        ai_client.get_client()


def test_openai_api_key_alone_never_enables_external_ai(monkeypatch):
    from backend import ai_client

    monkeypatch.setenv("OPENAI_API_KEY", "sk-live-present")
    monkeypatch.delenv("HANDOVER_AI_ENABLED", raising=False)
    monkeypatch.delenv("HANDOVER_EXTERNAL_CLINICAL_AI_ENABLED", raising=False)
    monkeypatch.delenv("HANDOVER_OPENAI_DISABLED", raising=False)
    monkeypatch.setenv("HANDOVER_DEPLOYMENT_MODE", "development")

    assert ai_client.is_openai_enabled() is False


def test_get_client_rejects_placeholder_api_key(monkeypatch):
    from backend import ai_client

    monkeypatch.setattr(ai_client, "_client", None, raising=False)
    monkeypatch.setenv("HANDOVER_AI_ENABLED", "1")
    monkeypatch.setenv("HANDOVER_OPENAI_DISABLED", "0")
    monkeypatch.setenv("OPENAI_API_KEY", "dummy")

    with pytest.raises(RuntimeError, match="placeholder"):
        ai_client.get_client()

def test_generate_sbar_is_awaitable_and_uses_thread_offload(monkeypatch):
    from backend import ai_client

    calls = {"to_thread": 0}

    async def fake_to_thread(func, *args, **kwargs):
        calls["to_thread"] += 1
        return func(*args, **kwargs)

    payload = {
        "situation": "s",
        "background": "b",
        "assessment": "a",
        "recommendation": "r",
        "full_text": "texto",
    }
    completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=ai_client.json.dumps(payload)))]
    )
    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_: completion))
    )

    monkeypatch.setattr(ai_client, "get_client", lambda: fake_client)
    monkeypatch.setattr(ai_client.asyncio, "to_thread", fake_to_thread)

    result = asyncio.run(ai_client.generate_sbar("nota clínica", language="es"))

    assert calls["to_thread"] == 1
    assert result["situation"] == "s"
    assert "Asistente de apoyo, no diagnóstico ni prescripción." in result["full_text"]



def test_transcribe_and_suggestions_are_awaitable(monkeypatch):
    from backend import ai_client

    transcription_request = {}

    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    def fake_transcription_create(**kwargs):
        transcription_request.update(kwargs)
        return transcription_response

    transcription_response = SimpleNamespace(text="  hola mundo  ")
    suggestions_payload = ai_client.json.dumps(
        {"interventions": ["Monitorizar constantes"], "rationale": "Racional breve"}
    )
    suggestions_completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=suggestions_payload))]
    )

    fake_client = SimpleNamespace(
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(create=fake_transcription_create)
        ),
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_: suggestions_completion)
        ),
    )

    monkeypatch.setattr(ai_client, "get_client", lambda: fake_client)
    monkeypatch.setattr(ai_client.asyncio, "to_thread", fake_to_thread)

    upload = UploadFile(filename="patient-identifier.m4a", file=io.BytesIO(b"bytes-audio"))
    transcription = asyncio.run(ai_client.transcribe_audio(upload, language="es"))

    ctx = ai_client.ClinicalContext(section="urgencias", notes="paciente estable")
    suggestions = asyncio.run(ai_client.generate_intervention_suggestions(ctx))

    assert transcription == "hola mundo"
    assert transcription_request["file"].name == "audio_input.m4a"
    assert suggestions.interventions == ["Monitorizar constantes"]
    assert suggestions.section == "urgencias"


@pytest.mark.parametrize(
    ("content_type", "filename", "extension"),
    [
        ("audio/aac", "patient.juan-perez", ".aac"),
        ("audio/m4a", "patient.name.with.dots.mp3", ".m4a"),
        ("audio/mp4", "no-extension", ".m4a"),
        ("audio/mp3", "paciente extraño.wav", ".mp3"),
        ("audio/mpeg", "patient.juan-perez", ".mp3"),
        ("audio/ogg", "patient.long.name.wav", ".ogg"),
        ("audio/wav", "patient.juan-perez", ".wav"),
        ("audio/webm", "patient.juan-perez", ".webm"),
        ("audio/x-m4a", "patient.juan-perez", ".m4a"),
    ],
)
def test_transcription_provider_name_comes_only_from_validated_mime(monkeypatch, caplog, content_type, filename, extension):
    from backend import ai_client

    provider_calls = []

    def fake_create(**kwargs):
        provider_calls.append(kwargs)
        return SimpleNamespace(text="texto")

    monkeypatch.setattr(ai_client, "get_client", lambda: SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=fake_create))))
    upload = UploadFile(filename=filename, file=io.BytesIO(b"audio"), content_type=content_type)

    assert asyncio.run(ai_client.transcribe_audio(upload, language="es")) == "texto"
    assert len(provider_calls) == 1
    assert provider_calls[0]["file"].name == f"audio_input{extension}"
    assert filename not in str(provider_calls[0]["file"].name)
    assert filename not in caplog.text


def test_transcription_rejects_unsupported_mime_before_provider(monkeypatch, caplog):
    from backend import ai_client

    provider_calls = []
    monkeypatch.setattr(ai_client, "get_client", lambda: provider_calls.append(True))
    upload = UploadFile(filename="PHI-audio.mp3", file=io.BytesIO(b"audio"), content_type="application/octet-stream")

    with pytest.raises(ValueError, match="unsupported-audio-type"):
        asyncio.run(ai_client.transcribe_audio(upload, language="es"))

    assert provider_calls == []
    assert "PHI-audio" not in caplog.text


def test_outcomes_suggestions_support_structured_noc_payload(monkeypatch):
    from backend import ai_client

    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    suggestions_payload = ai_client.json.dumps(
        {
            "outcomes": [
                {
                    "nocCode": "0402",
                    "nocDisplay": "Estado respiratorio: permeabilidad de las vías aéreas",
                    "baseline": 2,
                    "target": 4,
                    "current": 3,
                }
            ],
            "rationale": "Prioriza objetivos respiratorios para el siguiente turno.",
        }
    )
    suggestions_completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=suggestions_payload))]
    )
    fake_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_: suggestions_completion)
        )
    )

    monkeypatch.setattr(ai_client, "get_client", lambda: fake_client)
    monkeypatch.setattr(ai_client.asyncio, "to_thread", fake_to_thread)

    ctx = ai_client.ClinicalContext(section="outcomes", notes="disnea en mejoría")
    suggestions = asyncio.run(ai_client.generate_intervention_suggestions(ctx))

    assert suggestions.section == "outcomes"
    assert suggestions.outcomes is not None
    assert suggestions.outcomes[0].nocCode == "0402"
    assert suggestions.outcomes[0].baseline == 2
    assert suggestions.interventions[0].startswith("NOC 0402")
