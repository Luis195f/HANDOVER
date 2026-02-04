import io
import json
import pathlib
import sys

import pytest
from fastapi import UploadFile

sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from backend import ai_client

pytestmark = pytest.mark.anyio("asyncio")


@pytest.fixture
def anyio_backend():
    return "asyncio"


class DummyTranscription:
    def __init__(self, text: str):
        self.text = text


class DummyMessage:
    def __init__(self, content: str):
        self.content = content


class DummyCompletion:
    def __init__(self, content: str):
        self.choices = [type("choice", (), {"message": DummyMessage(content)})()]


class _DummyAudioTranscriptions:
    def __init__(self, create_fn):
        self.create = create_fn


class _DummyAudio:
    def __init__(self, create_fn):
        self.transcriptions = _DummyAudioTranscriptions(create_fn)


class _DummyChatCompletions:
    def __init__(self, create_fn):
        self.create = create_fn


class _DummyChat:
    def __init__(self, create_fn):
        self.completions = _DummyChatCompletions(create_fn)


class DummyClient:
    def __init__(self, transcribe_create_fn=None, completion_create_fn=None):
        self.audio = type("audio", (), {})()
        self.audio.transcriptions = _DummyAudioTranscriptions(transcribe_create_fn)

        self.chat = type("chat", (), {})()
        self.chat.completions = _DummyChatCompletions(completion_create_fn)


async def test_transcribe_audio_success(monkeypatch):
    def fake_create(**_kwargs):
        return DummyTranscription("texto IA")

    dummy = DummyClient(transcribe_create_fn=fake_create, completion_create_fn=None)
    monkeypatch.setattr(ai_client, "get_client", lambda: dummy)

    upload = UploadFile(filename="note.m4a", file=io.BytesIO(b"audio"))
    result = await ai_client.transcribe_audio(upload, "es")

    assert result == "texto IA"


async def test_generate_sbar_success(monkeypatch):
    content = json.dumps(
        {
            "situation": "S",
            "background": "B",
            "assessment": "A",
            "recommendation": "R",
            "full_text": "Full",
        }
    )

    def fake_completion(**_kwargs):
        return DummyCompletion(content)

    dummy = DummyClient(transcribe_create_fn=None, completion_create_fn=fake_completion)
    monkeypatch.setattr(ai_client, "get_client", lambda: dummy)

    result = await ai_client.generate_sbar("texto libre", "es")

    assert result["situation"] == "S"
    assert result["background"] == "B"
    assert result["assessment"] == "A"
    assert result["recommendation"] == "R"
    assert "Asistente de apoyo" in result["full_text"]


async def test_generate_sbar_invalid_response(monkeypatch):
    def fake_completion(**_kwargs):
        return DummyCompletion(json.dumps({"unexpected": "value"}))

    dummy = DummyClient(transcribe_create_fn=None, completion_create_fn=fake_completion)
    monkeypatch.setattr(ai_client, "get_client", lambda: dummy)

    with pytest.raises(RuntimeError):
        await ai_client.generate_sbar("texto libre", "es")
