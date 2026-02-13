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

try:
    import respx
except Exception:
    respx = None

if respx is None:
    pytest.skip('respx is required for these tests', allow_module_level=True)


def test_transaction_resources_contract_and_audit(monkeypatch):
    monkeypatch.setattr(views.BundleView, 'permission_classes', [])
    client = APIClient()
    sample_bundle = {'resourceType': 'Bundle', 'type': 'transaction', 'entry': [{'resource': {'resourceType': 'Encounter'}}]}
    with respx.mock(base_url=views.FHIR_BASE) as mock:
        tx_route = mock.post('/').mock(return_value=httpx.Response(200, json={'resourceType': 'Bundle'}))
        ae_route = mock.post('/AuditEvent').mock(return_value=httpx.Response(201, json={'resourceType': 'AuditEvent'}))
        r = client.post('/api/fhir/transaction', data=sample_bundle, format='json')
        assert r.status_code == 200
        assert tx_route.called and ae_route.called
