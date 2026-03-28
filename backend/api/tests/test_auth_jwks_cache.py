from unittest.mock import Mock, patch

from django.test import TestCase, override_settings

from backend.security import auth as auth_module


def _build_jwks_response(payload):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


class AuthJwksCachePartitioningTests(TestCase):
    def setUp(self):
        auth_module._JWKS_CACHE.clear()
        auth_module._JWKS_CACHE_TS.clear()

    @override_settings(AUTH0_ISSUER_BASE_URL="https://issuer-a.example")
    @patch("backend.security.auth.httpx.get")
    def test_reuses_jwks_cache_for_the_same_issuer_only(self, mock_get):
        mock_get.return_value = _build_jwks_response({"keys": [{"kid": "issuer-a"}]})

        first = auth_module._get_jwks()
        second = auth_module._get_jwks()

        self.assertEqual(first, {"keys": [{"kid": "issuer-a"}]})
        self.assertEqual(second, first)
        self.assertEqual(mock_get.call_count, 1)
        mock_get.assert_called_with("https://issuer-a.example/.well-known/jwks.json", timeout=10)

    @patch("backend.security.auth.httpx.get")
    def test_does_not_mix_cached_jwks_between_distinct_issuers(self, mock_get):
        mock_get.side_effect = [
            _build_jwks_response({"keys": [{"kid": "issuer-a"}]}),
            _build_jwks_response({"keys": [{"kid": "issuer-b"}]}),
        ]

        with override_settings(AUTH0_ISSUER_BASE_URL="https://issuer-a.example"):
            issuer_a_jwks = auth_module._get_jwks()
        with override_settings(AUTH0_ISSUER_BASE_URL="https://issuer-b.example"):
            issuer_b_jwks = auth_module._get_jwks()

        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(
            mock_get.call_args_list[0].args[0],
            "https://issuer-a.example/.well-known/jwks.json",
        )
        self.assertEqual(
            mock_get.call_args_list[1].args[0],
            "https://issuer-b.example/.well-known/jwks.json",
        )
        self.assertEqual(issuer_a_jwks, {"keys": [{"kid": "issuer-a"}]})
        self.assertEqual(issuer_b_jwks, {"keys": [{"kid": "issuer-b"}]})
