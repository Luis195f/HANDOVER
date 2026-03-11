import datetime
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from backend.security.auth import Auth0User


def _auth_client(*, roles=("nurse",), permissions=("handover:write",), sub="auth0|test-user"):
    claims = {
        "sub": sub,
        "roles": list(roles),
        "permissions": list(permissions),
    }
    client = APIClient()
    client.force_authenticate(user=Auth0User(sub=sub, claims=claims), token=claims)
    client.credentials(HTTP_AUTHORIZATION="Bearer test-access-token")
    return client


def _post(case: str, client: APIClient):
    if case == "transcribe":
        upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
        return client.post("/api/ai/transcribe", data={"file": upload, "language": "es"}, format="multipart")
    if case == "summarize":
        return client.post("/api/ai/summarize-sbar", data={"free_text": "Paciente estable"}, format="json")
    if case == "refine":
        return client.post(
            "/api/ai/refine-sbar",
            data={
                "draft": {
                    "situation": "Paciente estable",
                    "background": "Ingreso reciente",
                    "assessment": "Sin cambios",
                    "recommendation": "Continuar vigilancia",
                },
                "handover": {},
                "language": "es",
            },
            format="json",
        )
    if case == "suggest":
        return client.post(
            "/api/ai/suggest-interventions",
            data={"language": "es", "section": "other", "notes": "Paciente estable"},
            format="json",
        )
    if case == "upload":
        upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
        return client.post(
            "/api/upload/audio-to-fhir",
            data={"file": upload, "patientId": "p-123"},
            format="multipart",
        )
    raise AssertionError(f"Unknown case {case}")


@override_settings(DEBUG=True)
def test_ai_endpoints_require_auth_even_with_debug_enabled():
    client = APIClient()

    for case in ("transcribe", "summarize", "refine", "suggest", "upload"):
        response = _post(case, client)
        assert response.status_code == 401, (case, response.status_code, getattr(response, "data", None))


@override_settings(DEBUG=False)
def test_ai_endpoints_require_auth_without_debug_bypass():
    client = APIClient()

    for case in ("transcribe", "summarize", "refine", "suggest", "upload"):
        response = _post(case, client)
        assert response.status_code == 401, (case, response.status_code, getattr(response, "data", None))


def test_transcribe_forbids_role_without_ai_write_access():
    client = _auth_client(roles=("viewer",), permissions=("handover:write",))
    response = _post("transcribe", client)

    assert response.status_code == 403


def test_upload_forbids_missing_scope():
    client = _auth_client(roles=("nurse",), permissions=("patients:read",))
    response = _post("upload", client)

    assert response.status_code == 403


def test_transcribe_rejects_payload_too_large(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
    monkeypatch.setattr(views_ai, "HANDOVER_MAX_AUDIO_BYTES", 8, raising=False)

    upload = SimpleUploadedFile("audio.mp3", b"0123456789", content_type="audio/mpeg")
    response = client.post("/api/ai/transcribe", data={"file": upload, "language": "es"}, format="multipart")

    assert response.status_code == 413
    assert response.json()["code"] == "audio_payload_too_large"


def test_audio_to_fhir_rejects_invalid_mime():
    client = _auth_client()

    upload = SimpleUploadedFile("audio.bin", b"valid-bytes", content_type="application/octet-stream")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123"},
        format="multipart",
    )

    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_audio_type"


def test_transcribe_rejects_empty_content_type_without_safe_inference():
    client = _auth_client()

    upload = SimpleUploadedFile("audio.unknown", b"small", content_type="")
    response = client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_audio_type"


def test_transcribe_accepts_empty_content_type_with_safe_extension_inference(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()

    async def _fake_transcribe(*args, **kwargs):
        return "texto transcrito"

    monkeypatch.setattr(views_ai, "transcribe_audio", _fake_transcribe, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="")
    response = client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 200
    assert response.json()["text"] == "texto transcrito"


def test_audio_to_fhir_accepts_safe_inference_and_keeps_existing_flow(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
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
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123"},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.json()["resourceType"] == "DocumentReference"


def test_audio_to_fhir_redacts_upstream_error_body(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()

    class _MockResp:
        status_code = 422
        text = '{"detail":"Patient/p-123 inválido"}'

    monkeypatch.setattr(views_ai.httpx, "post", lambda *args, **kwargs: _MockResp(), raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123"},
        format="multipart",
    )

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "fhir_upload_rejected"
    assert "Patient/p-123" not in payload["detail"]


def test_transcribe_returns_503_when_openai_disabled(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
    monkeypatch.setattr(views_ai, "is_openai_enabled", lambda: False, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 503
    assert "deshabilitado" in response.json()["detail"]
    assert response.json()["code"] == "ai_disabled"
