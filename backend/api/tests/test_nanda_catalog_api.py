import json


def test_get_nanda_catalog_returns_json(client):
    response = client.get("/api/catalogs/nanda")

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload["system"] == "NANDA"
    assert payload["warning"] == "Licencia NANDA-I requerida"
    assert isinstance(payload["codes"], list)
    assert len(payload["codes"]) >= 1


def test_get_nanda_catalog_includes_cache_headers(client):
    response = client.get("/api/catalogs/nanda")

    assert response.status_code == 200
    etag = response.headers.get("ETag")
    cache_control = response.headers.get("Cache-Control")

    assert etag
    assert cache_control
    assert "max-age" in cache_control

    cached_response = client.get("/api/catalogs/nanda", HTTP_IF_NONE_MATCH=etag)
    assert cached_response.status_code == 304
    assert cached_response.headers.get("ETag") == etag
    assert cached_response.headers.get("Cache-Control") == cache_control
