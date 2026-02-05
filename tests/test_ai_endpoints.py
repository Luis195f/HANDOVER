import os
import pathlib
import sys

os.environ.setdefault('OPENAI_API_KEY', 'test')

import pytest
from fastapi.testclient import TestClient

sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

import main


@pytest.fixture
def client(monkeypatch):
    test_client = TestClient(main.app)

    async def fake_transcribe(*_args, **_kwargs):
        return 'texto IA'

    async def fake_generate(*_args, **_kwargs):
        return {
            'situation': 'S',
            'background': 'B',
            'assessment': 'A',
            'recommendation': 'R',
            'full_text': 'Full',
        }

    async def fake_suggest(ctx):
        return main.SuggestionsResponse(
            interventions=['Oxígeno', 'Monitorización'], rationale='Razonamiento', section=ctx.section
        )

    monkeypatch.setattr(main, 'transcribe_audio', fake_transcribe)
    monkeypatch.setattr(main, 'generate_sbar', fake_generate)
    monkeypatch.setattr(main, 'generate_intervention_suggestions', fake_suggest)
    return test_client


def test_ai_transcribe_success(client):
    response = client.post(
        '/ai/transcribe',
        files={'file': ('note.m4a', b'123', 'audio/m4a')},
        data={'language': 'es'},
    )

    assert response.status_code == 200
    assert response.json()['text'] == 'texto IA'


def test_ai_transcribe_invalid_mime(client):
    response = client.post(
        '/ai/transcribe',
        files={'file': ('note.txt', b'123', 'text/plain')},
    )

    assert response.status_code == 400


def test_summarize_sbar_success(client):
    response = client.post('/ai/summarize-sbar', json={'free_text': 'nota', 'language': 'es'})

    assert response.status_code == 200
    body = response.json()
    assert body['situation'] == 'S'
    assert body['full_text'] == 'Full'


def test_summarize_sbar_accepts_long_text_without_truncation(monkeypatch):
    test_client = TestClient(main.app)
    captured = {}
    long_text = 'x' * 800

    async def fake_generate(text, language='es'):
        captured['text'] = text
        return {
            'situation': 'S',
            'background': 'B',
            'assessment': 'A',
            'recommendation': 'R',
            'full_text': 'Full',
        }

    monkeypatch.setattr(main, 'generate_sbar', fake_generate)

    response = test_client.post('/ai/summarize-sbar', json={'free_text': long_text, 'language': 'es'})

    assert response.status_code == 200
    assert captured['text'] == long_text


def test_summarize_sbar_invalid_response(monkeypatch):
    test_client = TestClient(main.app)

    async def fake_generate(*_args, **_kwargs):
        return {'unexpected': 'data'}

    monkeypatch.setattr(main, 'generate_sbar', fake_generate)

    response = test_client.post('/ai/summarize-sbar', json={'free_text': 'nota', 'language': 'es'})

    assert response.status_code == 502


def test_suggest_interventions_success(client):
    response = client.post(
        '/ai/suggest-interventions',
        json={'section': 'vitals', 'language': 'es', 'vital_signs': {'hr': 110}, 'scores': {'news2': 6}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body['section'] == 'vitals'
    assert 'interventions' in body


def test_suggest_interventions_invalid_response(monkeypatch):
    test_client = TestClient(main.app)

    async def fake_suggest(*_args, **_kwargs):
        raise ValueError('invalid')

    monkeypatch.setattr(main, 'generate_intervention_suggestions', fake_suggest)

    response = test_client.post('/ai/suggest-interventions', json={'section': 'vitals'})

    assert response.status_code == 502
