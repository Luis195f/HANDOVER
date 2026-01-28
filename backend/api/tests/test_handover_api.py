# backend/api/tests/test_handover_api.py
from django.test import TestCase
from django.urls import reverse
from unittest.mock import patch, Mock

# Si usas DRF, es más cómodo:
try:
    from rest_framework.test import APIClient
except Exception:
    APIClient = None


class HandoverApiTests(TestCase):
    def setUp(self):
        self.client = APIClient() if APIClient else None

        # Usa el named-url real que existe en backend/api/urls.py
        # path("fhir/transaction", BundleView.as_view(), name="fhir-transaction")
        self.url = reverse("fhir-transaction")

        # Bundle mínimo válido (sin PHI real)
        self.valid_bundle = {
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

    def _post(self, payload):
        # Usa APIClient si existe; si no, cae a Django client tradicional
        if self.client:
            return self.client.post(
                self.url,
                data=payload,
                format="json",
                content_type="application/fhir+json",
            )
        else:
            import json
            from django.test import Client
            c = Client()
            return c.post(self.url, data=json.dumps(payload), content_type="application/fhir+json")

    def test_post_bundle_invalid(self):
        """
        Esperado: 422 cuando el bundle es inválido.
        Según backend/api/views.py: retorna 422 si bundle.type != "transaction".
        """
        bad_bundle = {
            "resourceType": "Bundle",
            "type": "collection",  # <-- fuerza el 422 por la validación real del backend
            "entry": [{"resource": {}}],
        }

        resp = self._post(bad_bundle)

        self.assertEqual(
            resp.status_code,
            422,
            msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}",
        )

    @patch("backend.api.views.httpx.post", autospec=True)
    def test_post_bundle_success(self, mock_httpx_post):
        """
        Esperado: 201 (o 200) cuando el bundle es válido.
        IMPORTANTE: el backend hace POST al servidor FHIR usando httpx.post(...),
        por lo que mockeamos backend.api.views.httpx.post para correr offline.
        """

        # Simula respuesta del servidor FHIR (ajusta status si tu view devuelve 200/201)
        mock_resp = Mock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"resourceType": "Bundle", "type": "transaction-response"}
        mock_resp.text = '{"resourceType":"Bundle","type":"transaction-response"}'
        mock_httpx_post.return_value = mock_resp

        resp = self._post(self.valid_bundle)

        self.assertIn(
            resp.status_code,
            (200, 201),
            msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}",
        )
