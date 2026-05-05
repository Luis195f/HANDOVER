import types

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from backend.api.models import HandoverBundleRecord


class ClientCredentialsEtlPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("handover-etl-read", kwargs={"bundle_id": "bundle-etl-permission"})
        HandoverBundleRecord.objects.create(
            bundle_id="bundle-etl-permission",
            patient_id="patient-etl-permission",
            unit_id="uci-etl",
            request_id="req-etl-permission",
            bundle_json={"resourceType": "Bundle", "id": "bundle-etl-permission", "type": "transaction"},
            expires_at=HandoverBundleRecord.default_expiry(),
        )

    def _auth(
        self,
        *,
        roles: list[str],
        scopes: list[str],
        gty: str = "client-credentials",
        include_bearer: bool = True,
    ) -> None:
        claims = {
            "sub": "auth0|svc-etl",
            "roles": roles,
            "permissions": scopes,
            "scope": " ".join(scopes),
            "gty": gty,
        }
        user = types.SimpleNamespace(
            is_authenticated=True,
            claims=claims,
            sub="auth0|svc-etl",
            username="svc-etl",
        )
        self.client.force_authenticate(user=user, token=claims)
        if include_bearer:
            self.client.credentials(HTTP_AUTHORIZATION="Bearer etl-token-value")
        else:
            self.client.credentials()

    def test_etl_permission_denies_when_bearer_missing(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "auth-required")

    def test_etl_permission_denies_when_grant_type_is_not_client_credentials(self):
        self._auth(roles=["service_etl"], scopes=["handover:etl:read"], gty="password")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "forbidden-grant-type")

    def test_etl_permission_denies_when_etl_scope_is_missing(self):
        self._auth(roles=["service_etl"], scopes=["fhir:transaction"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "forbidden-scope")

    def test_etl_permission_allows_client_credentials_with_etl_scope(self):
        self._auth(roles=["service_etl"], scopes=["handover:etl:read"])

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
