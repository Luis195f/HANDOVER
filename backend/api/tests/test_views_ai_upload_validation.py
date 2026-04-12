import datetime
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from backend.security.auth import Auth0User


def _auth_client(
    *,
    roles=("nurse",),
    permissions=("handover:write", "patients:read"),
    unit_ids=("icu-a",),
    sub="auth0|test-user",
):
    claims = {
        "sub": sub,
        "roles": list(roles),
        "permissions": list(permissions),
        "unitIds": list(unit_ids),
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
    if case == "clinical-decision":
        return client.post(
            "/api/ai/clinical-decision",
            data={
                "patientId": "p-123",
                "unitId": "icu-a",
                "suggestionSource": "ai_nic_suggestions",
                "decision": "applied",
            },
            format="json",
        )
    if case == "upload":
        upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
        return client.post(
            "/api/upload/audio-to-fhir",
            data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
            format="multipart",
        )
    raise AssertionError(f"Unknown case {case}")


def _patient_payload(unit_id: str | None) -> dict:
    patient = {
        "resourceType": "Patient",
        "id": "p-123",
    }
    if unit_id:
        patient["extension"] = [
            {
                "url": "https://handover.dev/fhir/StructureDefinition/unit-id",
                "valueString": unit_id,
            }
        ]
    return patient


@override_settings(DEBUG=True)
def test_ai_endpoints_require_auth_even_with_debug_enabled():
    client = APIClient()

    for case in ("transcribe", "summarize", "refine", "suggest", "clinical-decision", "upload"):
        response = _post(case, client)
        assert response.status_code == 401, (case, response.status_code, getattr(response, "data", None))


@override_settings(DEBUG=False)
def test_ai_endpoints_require_auth_without_debug_bypass():
    client = APIClient()

    for case in ("transcribe", "summarize", "refine", "suggest", "clinical-decision", "upload"):
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
        data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
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

    class _MockGetResp:
        status_code = 200

        def json(self):
            return _patient_payload("icu-a")

    def _mock_post(*args, **kwargs):
        assert kwargs["json"]["content"][0]["attachment"]["contentType"] == "audio/mpeg"
        return _MockResp()

    monkeypatch.setattr(views_ai.httpx, "get", lambda *args, **kwargs: _MockGetResp(), raising=True)
    monkeypatch.setattr(views_ai.httpx, "post", _mock_post, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.json()["resourceType"] == "DocumentReference"


def test_audio_to_fhir_redacts_upstream_error_body(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()

    class _MockGetResp:
        status_code = 200

        def json(self):
            return _patient_payload("icu-a")

    class _MockResp:
        status_code = 422
        text = '{"detail":"Patient/p-123 inválido"}'

    monkeypatch.setattr(views_ai.httpx, "get", lambda *args, **kwargs: _MockGetResp(), raising=True)
    monkeypatch.setattr(views_ai.httpx, "post", lambda *args, **kwargs: _MockResp(), raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
        format="multipart",
    )

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "fhir_upload_rejected"
    assert "Patient/p-123" not in payload["detail"]


def test_audio_to_fhir_forbids_unit_outside_scope():
    client = _auth_client(unit_ids=("icu-a",))

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123", "unitId": "icu-b"},
        format="multipart",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "patients_forbidden_unit"


def test_audio_to_fhir_rejects_patient_unit_mismatch(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client(unit_ids=("icu-a",))

    class _MockGetResp:
        status_code = 200

        def json(self):
            return _patient_payload("ward-z")

    monkeypatch.setattr(views_ai.httpx, "get", lambda *args, **kwargs: _MockGetResp(), raising=True)

    def _unexpected_post(*args, **kwargs):
        raise AssertionError("upload post should not be attempted when patient/unit mismatch is detected")

    monkeypatch.setattr(views_ai.httpx, "post", _unexpected_post, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
        format="multipart",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "audio_upload_patient_unit_mismatch"


def test_audio_to_fhir_rejects_patient_without_resolvable_unit(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client(unit_ids=("icu-a",))

    class _MockGetResp:
        status_code = 200

        def json(self):
            return _patient_payload(None)

    monkeypatch.setattr(views_ai.httpx, "get", lambda *args, **kwargs: _MockGetResp(), raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post(
        "/api/upload/audio-to-fhir",
        data={"file": upload, "patientId": "p-123", "unitId": "icu-a"},
        format="multipart",
    )

    assert response.status_code == 403
    assert response.json()["code"] == "audio_upload_patient_unit_unresolved"


def test_transcribe_returns_503_when_openai_disabled(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
    monkeypatch.setattr(views_ai, "is_openai_enabled", lambda: False, raising=True)

    upload = SimpleUploadedFile("audio.mp3", b"small", content_type="audio/mpeg")
    response = client.post("/api/ai/transcribe", data={"file": upload}, format="multipart")

    assert response.status_code == 503
    assert "deshabilitado" in response.json()["detail"]
    assert response.json()["code"] == "ai_disabled"

def test_refine_rejects_integer_draft_fields(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
    monkeypatch.setattr(views_ai, 'generate_sbar', lambda *args, **kwargs: None, raising=False)

    response = client.post(
        '/api/ai/refine-sbar',
        data={
            'draft': {
                'situation': 1,
                'background': 'Ingreso reciente',
                'assessment': 'Sin cambios',
                'recommendation': 'Continuar vigilancia',
            },
            'handover': {},
            'language': 'es',
        },
        format='json',
    )

    assert response.status_code == 400
    assert response.json()['code'] == 'invalid_refine_draft'
    assert response.json()['detail'] == 'draft.situation must be a string or null.'


def test_refine_rejects_object_draft_fields(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()
    monkeypatch.setattr(views_ai, 'generate_sbar', lambda *args, **kwargs: None, raising=False)

    response = client.post(
        '/api/ai/refine-sbar',
        data={
            'draft': {
                'situation': 'Paciente estable',
                'background': {'ward': 'ICU-A'},
                'assessment': 'Sin cambios',
                'recommendation': 'Continuar vigilancia',
            },
            'handover': {},
            'language': 'es',
        },
        format='json',
    )

    assert response.status_code == 400
    assert response.json()['code'] == 'invalid_refine_draft'
    assert response.json()['detail'] == 'draft.background must be a string or null.'


def test_refine_treats_null_and_missing_draft_fields_as_empty_strings(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()

    async def _fake_generate(combined_text, **_kwargs):
        assert 'S: dato no disponible' in combined_text
        assert 'B: dato no disponible' in combined_text
        assert 'A: dato no disponible' in combined_text
        assert 'R: dato no disponible' in combined_text
        return {
            'situation': 'S2',
            'background': 'B2',
            'assessment': 'A2',
            'recommendation': 'R2',
            'full_text': 'Full',
        }

    monkeypatch.setattr(views_ai, 'generate_sbar', _fake_generate, raising=True)

    response = client.post(
        '/api/ai/refine-sbar',
        data={
            'draft': {
                'situation': None,
                'assessment': None,
            },
            'handover': {'evolution': 'estable'},
            'language': 'es',
        },
        format='json',
    )

    assert response.status_code == 200
    assert response.json()['sbar']['recommendation'] == 'R2'


def test_refine_returns_200_for_valid_string_draft(monkeypatch):
    import backend.api.views_ai as views_ai

    client = _auth_client()

    async def _fake_generate(*_args, **_kwargs):
        return {
            'situation': 'S2',
            'background': 'B2',
            'assessment': 'A2',
            'recommendation': 'R2',
            'full_text': 'Full',
        }

    monkeypatch.setattr(views_ai, 'generate_sbar', _fake_generate, raising=True)

    response = client.post(
        '/api/ai/refine-sbar',
        data={
            'draft': {
                'situation': 'Paciente estable',
                'background': 'Ingreso reciente',
                'assessment': 'Sin cambios',
                'recommendation': 'Continuar vigilancia',
            },
            'handover': {},
            'language': 'es',
        },
        format='json',
    )

    assert response.status_code == 200
    assert response.json()['sbar']['assessment'] == 'A2'


def test_refine_rejects_list_draft():
    client = _auth_client()

    response = client.post(
        '/api/ai/refine-sbar',
        data={'draft': ['unexpected'], 'handover': {}, 'language': 'es'},
        format='json',
    )

    assert response.status_code == 400
    assert response.json() == {'detail': 'draft must be an object.', 'code': 'invalid_refine_draft'}


def test_refine_rejects_string_draft():
    client = _auth_client()

    response = client.post(
        '/api/ai/refine-sbar',
        data={'draft': 'unexpected', 'handover': {}, 'language': 'es'},
        format='json',
    )

    assert response.status_code == 400
    assert response.json() == {'detail': 'draft must be an object.', 'code': 'invalid_refine_draft'}


def test_refine_rejects_boolean_draft():
    client = _auth_client()

    response = client.post(
        '/api/ai/refine-sbar',
        data={'draft': True, 'handover': {}, 'language': 'es'},
        format='json',
    )

    assert response.status_code == 400
    assert response.json() == {'detail': 'draft must be an object.', 'code': 'invalid_refine_draft'}


def test_refine_rejects_list_handover():
    client = _auth_client()

    response = client.post(
        '/api/ai/refine-sbar',
        data={'draft': {}, 'handover': ['unexpected'], 'language': 'es'},
        format='json',
    )

    assert response.status_code == 400
    assert response.json() == {'detail': 'handover must be an object.', 'code': 'invalid_refine_handover'}


def test_refine_rejects_string_handover():
    client = _auth_client()

    response = client.post(
        '/api/ai/refine-sbar',
        data={'draft': {}, 'handover': 'unexpected', 'language': 'es'},
        format='json',
    )

    assert response.status_code == 400
    assert response.json() == {'detail': 'handover must be an object.', 'code': 'invalid_refine_handover'}
