from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient


@override_settings(
    DEBUG=False,
    AUTH0_CONFIGURED=True,
    AUTH0_ISSUER_BASE_URL="https://pilot-auth.example",
    AUTH0_AUDIENCE="https://handover-api.example",
    HANDOVER_DEPLOYMENT_MODE="pilot",
    HANDOVER_DEPLOYMENT_MODE_EXPLICIT=True,
    HANDOVER_LOCAL_AUTH_BYPASS_ALLOWED=False,
    HANDOVER_TEST_AUTH_BYPASS_ALLOWED=False,
)
class PilotAuthSmokeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.protected_routes = [
            {
                "name": "me-capabilities",
                "method": "get",
                "url": reverse("me-capabilities"),
            },
            {
                "name": "fhir-transaction",
                "method": "post",
                "url": reverse("fhir-transaction"),
                "data": {"resourceType": "Bundle", "type": "transaction", "entry": []},
            },
            {
                "name": "handover-etl-read",
                "method": "get",
                "url": reverse("handover-etl-read", kwargs={"bundle_id": "pilot-auth-smoke"}),
            },
        ]

    def _request(self, route: dict[str, object], authorization: str | None = None):
        headers = {}
        if authorization is not None:
            headers["HTTP_AUTHORIZATION"] = authorization

        if route["method"] == "get":
            return self.client.get(route["url"], **headers)

        return self.client.post(route["url"], data=route["data"], format="json", **headers)

    def _assert_auth_error(self, response, *, expected_code: str) -> None:
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], expected_code)

    def test_protected_routes_fail_closed_without_authorization_in_pilot_like_mode(self):
        for route in self.protected_routes:
            with self.subTest(route=route["name"]):
                response = self._request(route)

                self._assert_auth_error(response, expected_code="auth-required")

    def test_protected_routes_fail_closed_with_invalid_bearer_in_pilot_like_mode(self):
        for route in self.protected_routes:
            with self.subTest(route=route["name"]):
                response = self._request(route, authorization="Bearer invalid-token")

                self._assert_auth_error(response, expected_code="auth-failed")
