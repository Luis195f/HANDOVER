import datetime
from django.core.files.uploadedfile import SimpleUploadedFile


def _allow_authenticated_only(monkeypatch):
    import backend.api.views_ai as views_ai

    monkeypatch.setattr(
        views_ai.TranscribeView,
        "get_permissions",
        lambda self: [views_ai.IsAuthenticated()],
        raising=False,
    )
    monkeypatch.setattr(
        views_ai.AudioToFHIRView,
        "get_permissions",
        lambda self: [views_ai.IsAuthenticated()],
        raising=False,
    )


def test_transcribe_rejects_payload_too_large(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)
    monkeypatch.setattr(views_ai, "HANDOVER_MAX_AUDIO_BYTES", 8, raising=False)

    upload = SimpleUploadedFile("audio.mp3", b"0123456789", content_type="audio/mpeg")
    response = api_client.post("/api/ai/transcribe", data={"file": upload, "language": "es"}, format="multipart")

    assert response.status_code == 413


def test_audio_to_fhir_rejects_invalid_mime(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)

    upload = SimpleUploadedFile("audio.bin", b"valid-bytes", content_type="application/octet-stream")
    response = api_client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123"},
        format="multipart",
    )

    assert response.status_code == 415


def test_transcribe_rejects_empty_content_type_without_safe_inference(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)

    upload = SimpleUploadedFile("audio.unknown", b"small", content_type="")
    response = api_client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 415


def test_transcribe_accepts_empty_content_type_with_safe_extension_inference(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)

    async def _fake_transcribe(*args, **kwargs):
        return "texto transcrito"

    monkeypatch.setattr(views_ai, "transcribe_audio", _fake_transcribe, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="")
    response = api_client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 200
    assert response.json()["text"] == "texto transcrito"



def test_audio_to_fhir_accepts_safe_inference_and_keeps_existing_flow(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)
    monkeypatch.setattr(views_ai.datetime, "UTC", datetime.timezone.utc, raising=False)

    class _MockResp:
        status_code = 201

        def json(self):
            return {"resourceType": "DocumentReference", "id": "doc-1"}

    def _mock_post(*args, **kwargs):
        assert kwargs["json"]["content"][0]["attachment"]["contentType"] == "audio/mpeg"
        return _MockResp()

    monkeypatch.setattr(views_ai.httpx, "post", _mock_post, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="")
    response = api_client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123"},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.json()["resourceType"] == "DocumentReference"


def test_transcribe_returns_503_when_openai_disabled(monkeypatch, api_client):
    import backend.api.views_ai as views_ai

    _allow_authenticated_only(monkeypatch)
    monkeypatch.setattr(views_ai, "is_openai_enabled", lambda: False, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = api_client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 503
    assert "deshabilitado" in response.json()["detail"]
