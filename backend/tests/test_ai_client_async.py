import asyncio
import importlib
import io
import sys
from types import SimpleNamespace

import pytest


class UploadFile:
    def __init__(self, *, filename: str, file):
        self.filename = filename
        self.file = file

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

    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    transcription_response = SimpleNamespace(text="  hola mundo  ")
    suggestions_payload = ai_client.json.dumps(
        {"interventions": ["Monitorizar constantes"], "rationale": "Racional breve"}
    )
    suggestions_completion = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=suggestions_payload))]
    )

    fake_client = SimpleNamespace(
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(create=lambda **_: transcription_response)
        ),
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_: suggestions_completion)
        ),
    )

    monkeypatch.setattr(ai_client, "get_client", lambda: fake_client)
    monkeypatch.setattr(ai_client.asyncio, "to_thread", fake_to_thread)

    upload = UploadFile(filename="audio.m4a", file=io.BytesIO(b"bytes-audio"))
    transcription = asyncio.run(ai_client.transcribe_audio(upload, language="es"))

    ctx = ai_client.ClinicalContext(section="urgencias", notes="paciente estable")
    suggestions = asyncio.run(ai_client.generate_intervention_suggestions(ctx))

    assert transcription == "hola mundo"
    assert suggestions.interventions == ["Monitorizar constantes"]
    assert suggestions.section == "urgencias"
