import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
import django
django.setup()
import pathlib
import sys
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

from rest_framework.test import APIClient
from backend.security.auth import Auth0User
from backend.api import views_ai
from django.core.files.uploadedfile import SimpleUploadedFile


def _client():
    claims = {
        'sub': 'auth0|ai-test-user',
        'roles': ['nurse'],
        'permissions': ['handover:write'],
    }
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=claims['sub'], claims=claims), token=claims)
    client.credentials(HTTP_AUTHORIZATION='Bearer test-access-token')
    return client


def test_ai_transcribe_success(monkeypatch):
    client = _client()

    async def fake_transcribe(*_args, **_kwargs):
        return "texto IA"

    monkeypatch.setattr(views_ai, "transcribe_audio", fake_transcribe)

    upload = SimpleUploadedFile(
        "note.m4a",
        b"123",
        content_type="audio/m4a",
    )

    response = client.post(
        "/api/ai/transcribe",
        data={"language": "es", "file": upload},
        format="multipart",
    )
    assert response.status_code == 200


def test_summarize_sbar_success(monkeypatch):
    client = _client()

    async def fake_generate(*_args, **_kwargs):
        return {'situation': 'S', 'background': 'B', 'assessment': 'A', 'recommendation': 'R', 'full_text': 'Full'}

    monkeypatch.setattr(views_ai, 'generate_sbar', fake_generate)
    response = client.post('/api/ai/summarize-sbar', data={'free_text': 'nota', 'language': 'es'}, format='json')
    assert response.status_code == 200


def test_refine_sbar_success(monkeypatch):
    client = _client()

    async def fake_generate(*_args, **_kwargs):
        return {'situation': 'S2', 'background': 'B2', 'assessment': 'A2', 'recommendation': 'R2', 'full_text': 'Full'}

    monkeypatch.setattr(views_ai, 'generate_sbar', fake_generate)
    response = client.post(
        '/api/ai/refine-sbar',
        data={
            'draft': {'situation': 'S', 'background': 'B', 'assessment': 'A', 'recommendation': 'R'},
            'handover': {'evolution': 'estable'},
            'language': 'es',
        },
        format='json',
    )
    assert response.status_code == 200
    assert response.json()['sbar']['assessment'] == 'A2'
