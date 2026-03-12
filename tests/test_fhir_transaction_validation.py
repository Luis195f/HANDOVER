import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
import django
django.setup()
import pathlib
import sys
sys.path.append(str(pathlib.Path(__file__).resolve().parent.parent))

import httpx
import pytest
from rest_framework.test import APIClient
from backend.api import views
from backend.api.tests.icea_test_utils import authenticate_api_client

try:
    import respx
except Exception:
    respx = None

if respx is None:
    pytest.skip('respx is required for these tests', allow_module_level=True)


def test_remote_validation_blocks_on_error(monkeypatch):
    monkeypatch.setattr(views, 'HANDOVER_FHIR_VALIDATION_MODE', 'remote')
    client = APIClient()
    authenticate_api_client(client)
    with respx.mock(base_url=views.FHIR_BASE) as mock:
        mock.post('/Bundle/$validate').mock(return_value=httpx.Response(200, json={'resourceType': 'OperationOutcome', 'issue': [{'severity': 'error'}]}))
        r = client.post('/api/fhir/transaction', data={'resourceType': 'Bundle', 'type': 'transaction', 'entry': []}, format='json')
        assert r.status_code == 422
