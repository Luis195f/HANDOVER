import os
import time
from typing import Dict

import httpx
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.test import SimpleTestCase
from jose import jwt
from jose.utils import base64url_encode

from backend.authentication import reset_jwks_cache, verify_jwt_token


def _generate_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk_from_public_key(key: rsa.RSAPublicKey, kid: str) -> Dict[str, str]:
    numbers = key.public_numbers()
    e = base64url_encode(numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, 'big')).decode()
    n = base64url_encode(numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, 'big')).decode()
    return {"kty": "RSA", "use": "sig", "kid": kid, "alg": "RS256", "n": n, "e": e}


class VerifyJwtTokenTests(SimpleTestCase):
    def setUp(self):
        reset_jwks_cache()
        self.issuer = "https://auth.example.test/realms/hospital"
        self.audience = "handover-app"
        self.jwks_uri = f"{self.issuer}/protocol/openid-connect/certs"
        self.private_key = _generate_key()
        self.private_pem = self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        self.jwk = _jwk_from_public_key(self.private_key.public_key(), "kid-1")

        os.environ.update({
            "OIDC_ISSUER": self.issuer,
            "OIDC_AUDIENCE": self.audience,
            "OIDC_JWKS_URI": self.jwks_uri,
        })

    def tearDown(self):
        reset_jwks_cache()
        os.environ.pop("OIDC_ISSUER", None)
        os.environ.pop("OIDC_AUDIENCE", None)
        os.environ.pop("OIDC_JWKS_URI", None)

    def _issue_token(self, **overrides) -> str:
        now = int(time.time())
        claims = {
            "sub": "user-1",
            "preferred_username": "demo",
            "aud": self.audience,
            "iss": self.issuer,
            "exp": now + 3600,
            "iat": now,
            **overrides,
        }
        return jwt.encode(claims, self.private_pem, algorithm="RS256", headers={"kid": self.jwk["kid"]})

    @respx.mock
    def test_accepts_valid_token(self):
        respx.get(self.jwks_uri).mock(return_value=httpx.Response(200, json={"keys": [self.jwk]}))

        claims = verify_jwt_token(self._issue_token())

        self.assertEqual(claims["sub"], "user-1")
        self.assertEqual(claims["preferred_username"], "demo")

    @respx.mock
    def test_rejects_invalid_signature(self):
        other_key = _generate_key()
        other_pem = other_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        respx.get(self.jwks_uri).mock(return_value=httpx.Response(200, json={"keys": [self.jwk]}))

        with self.assertRaises(Exception):
            forged = jwt.encode(
                {
                    "sub": "user-1",
                    "aud": self.audience,
                    "iss": self.issuer,
                    "exp": int(time.time()) + 10,
                },
                other_pem,
                algorithm="RS256",
                headers={"kid": self.jwk["kid"]},
            )
            verify_jwt_token(forged)

    @respx.mock
    def test_rejects_expired_token(self):
        respx.get(self.jwks_uri).mock(return_value=httpx.Response(200, json={"keys": [self.jwk]}))

        expired = self._issue_token(exp=int(time.time()) - 10)
        with self.assertRaises(Exception):
            verify_jwt_token(expired)
