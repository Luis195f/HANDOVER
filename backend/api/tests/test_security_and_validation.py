# backend/api/tests/test_security_and_validation.py
import json

import backend.security.auth as jwt_auth


FHIR_TX_URL = "/api/fhir/transaction"

VALID_BUNDLE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "entry": [
        {
            "request": {"method": "POST", "url": "Patient"},
            "resource": {
                "resourceType": "Patient",
                "id": "pat-test-001",
                "name": [{"use": "official", "family": "Test", "given": ["Paciente"]}],
                "gender": "unknown",
            },
        }
    ],
}

INVALID_BUNDLE = {
    "resourceType": "Bundle",
    "type": "collection",  # fuerza 422 por tu lógica
    "entry": [{"resource": {}}],
}


def _post_fhir(api_client, payload, token: str | None = None):
    headers = {}
    if token:
        headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    # DRF APIClient: NO uses format+content_type juntos. Sólo content_type.
    return api_client.post(
        FHIR_TX_URL,
        data=json.dumps(payload),
        content_type="application/fhir+json",
        **headers,
    )


def test_no_token_401_or_403(client):
    # Aquí usamos el client estándar (sin auth) para verificar que protege algo real.
    # Si tu endpoint no requiere auth, ajusta esto.
    res = client.post(
        FHIR_TX_URL,
        data=json.dumps(VALID_BUNDLE),
        content_type="application/fhir+json",
    )
    assert res.status_code in (401, 403)


def test_invalid_payload_422(monkeypatch, api_client):
    """
    Queremos llegar a la validación (422) SIN que nos bloquee RequireRolesPermission.
    PERO BundleView probablemente sobreescribe get_permissions(), así que parchamos ese método.
    """
    import backend.api.views as api_views  # noqa: E402

    # ✅ Bypass definitivo: ignora RequireRolesPermission aunque get_permissions esté sobrescrito.
    monkeypatch.setattr(
        api_views.BundleView,
        "get_permissions",
        lambda self: [api_views.IsAuthenticated()],
        raising=False,
    )

    # Si tu código mira verify_jwt en algún sitio, lo dejamos estable para tests
    monkeypatch.setattr(jwt_auth, "verify_jwt", lambda token: {"scope": "handover:write"}, raising=False)

    res = _post_fhir(api_client, INVALID_BUNDLE, token="test")
    assert res.status_code == 422
    data = res.json()
    assert data.get("code") == "INVALID_BUNDLE"


def test_ok_200_or_201(monkeypatch, api_client):
    """
    Igual que arriba, pero simulando respuesta OK del proxy httpx.post.
    """
    import backend.api.views as api_views  # noqa: E402

    monkeypatch.setattr(
        api_views.BundleView,
        "get_permissions",
        lambda self: [api_views.IsAuthenticated()],
        raising=False,
    )

    monkeypatch.setattr(jwt_auth, "verify_jwt", lambda token: {"scope": "handover:write"}, raising=False)

    class _MockResp:
        status_code = 201
        text = '{"resourceType":"Bundle","type":"transaction-response"}'

        def json(self):
            return {"resourceType": "Bundle", "type": "transaction-response"}

    monkeypatch.setattr(api_views.httpx, "post", lambda *a, **k: _MockResp(), raising=True)

    res = _post_fhir(api_client, VALID_BUNDLE, token="test")
    assert res.status_code in (200, 201)
