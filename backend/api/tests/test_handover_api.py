from django.test import TestCase
from django.urls import reverse
from unittest.mock import patch

# Si usas DRF, es más cómodo:
try:
    from rest_framework.test import APIClient
except Exception:
    APIClient = None


class HandoverApiTests(TestCase):
    def setUp(self):
        self.client = APIClient() if APIClient else None

        # Endpoint (ajusta si tu ruta real es distinta)
        # Opción A: hardcode directo
        self.url = "/api/fhir/transaction"
        # Opción B (si tienes named-url):
        # self.url = reverse("fhir-transaction")

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
            # Django Client estándar requiere JSON serializado; pero simplificamos:
            import json
            from django.test import Client
            c = Client()
            return c.post(self.url, data=json.dumps(payload), content_type="application/fhir+json")

    @patch("backend.api.services.fhir_validation.validate_bundle", autospec=True)
    def test_post_bundle_success(self, mock_validate):
        """
        Esperado: 201 cuando el bundle es válido.
        El mock evita llamadas reales a servidores/servicios externos.
        """
        mock_validate.return_value = (True, None)

        resp = self._post(self.valid_bundle)

        self.assertIn(resp.status_code, (200, 201), msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}")

    @patch("backend.api.services.fhir_validation.validate_bundle", autospec=True)
    def test_post_bundle_invalid(self, mock_validate):
        """
        Esperado: 422 cuando el bundle es inválido.
        """
        mock_validate.return_value = (False, {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "invalid"}]})

        bad_bundle = {
            "resourceType": "Bundle",
            "type": "transaction",
            "entry": [{"resource": {}}],
        }

        resp = self._post(bad_bundle)

        self.assertEqual(resp.status_code, 422, msg=f"Unexpected status: {resp.status_code}, body={getattr(resp,'data',resp.content)}")

