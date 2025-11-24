import io
import json
import pathlib
import sys

import pytest
from fastapi import UploadFile

sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from backend import ai_client

pytestmark = pytest.mark.anyio('asyncio')


@pytest.fixture
def anyio_backend():
    return 'asyncio'


class DummyTranscription:
    def __init__(self, text: str):
        self.text = text


class DummyMessage:
    def __init__(self, content: str):
        self.content = content


class DummyCompletion:
    def __init__(self, content: str):
        self.choices = [type('choice', (), {'message': DummyMessage(content)})()]


async def test_transcribe_audio_success(monkeypatch):
    def fake_create(**_kwargs):
        return DummyTranscription('texto IA')

    monkeypatch.setattr(ai_client.client.audio.transcriptions, 'create', fake_create)
    upload = UploadFile(filename='note.m4a', file=io.BytesIO(b'audio'))

    result = await ai_client.transcribe_audio(upload, 'es')

    assert result == 'texto IA'


async def test_generate_sbar_success(monkeypatch):
    content = json.dumps(
        {
          'situation': 'S',
          'background': 'B',
          'assessment': 'A',
          'recommendation': 'R',
          'full_text': 'Full',
        }
    )

    def fake_completion(**_kwargs):
        return DummyCompletion(content)

    monkeypatch.setattr(ai_client.client.chat.completions, 'create', fake_completion)

    result = await ai_client.generate_sbar('texto libre', 'es')

    assert result == {
        'situation': 'S',
        'background': 'B',
        'assessment': 'A',
        'recommendation': 'R',
        'full_text': 'Full',
    }


async def test_generate_sbar_invalid_response(monkeypatch):
    def fake_completion(**_kwargs):
        return DummyCompletion(json.dumps({'unexpected': 'value'}))

    monkeypatch.setattr(ai_client.client.chat.completions, 'create', fake_completion)

    with pytest.raises(RuntimeError):
        await ai_client.generate_sbar('texto libre', 'es')
