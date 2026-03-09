import json

import pytest


@pytest.mark.parametrize(
    ("path", "system", "warning"),
    [
        ("/api/catalogs/nanda", "NANDA", "Licencia NANDA-I requerida"),
        ("/api/catalogs/nic", "NIC", "Licencia NIC requerida"),
        ("/api/catalogs/noc", "NOC", "Licencia NOC requerida"),
    ],
)
def test_get_governed_catalog_returns_json(client, path, system, warning):
    response = client.get(path)

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload["system"] == system
    assert payload["warning"] == warning
    assert isinstance(payload["codes"], list)
    assert len(payload["codes"]) >= 1


@pytest.mark.parametrize("path", ["/api/catalogs/nanda", "/api/catalogs/nic", "/api/catalogs/noc"])
def test_get_governed_catalog_includes_cache_headers(client, path):
    response = client.get(path)

    assert response.status_code == 200
    etag = response.headers.get("ETag")
    cache_control = response.headers.get("Cache-Control")

    assert etag
    assert cache_control
    assert "max-age" in cache_control

    cached_response = client.get(path, HTTP_IF_NONE_MATCH=etag)
    assert cached_response.status_code == 304
    assert cached_response.headers.get("ETag") == etag
    assert cached_response.headers.get("Cache-Control") == cache_control
