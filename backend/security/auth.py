# backend/security/auth.py
from __future__ import annotations

import base64
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

AUTH0_ISSUER_BASE_URL = os.getenv("AUTH0_ISSUER_BASE_URL", "").rstrip("/")
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")

ALGORITHMS = ["RS256"]
JWKS_URL = f"{AUTH0_ISSUER_BASE_URL}/.well-known/jwks.json"

# Cache simple de JWKS
_JWKS_CACHE: Optional[Dict[str, Any]] = None
_JWKS_CACHE_TS: float = 0.0
_JWKS_TTL_SECONDS = 3600


def _get_bearer_token(request) -> str:
    auth = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth:
        raise AuthenticationFailed("Missing Authorization header")

    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthenticationFailed("Invalid Authorization header (expected: Bearer <token>)")

    return parts[1]


def _get_jwks() -> Dict[str, Any]:
    global _JWKS_CACHE, _JWKS_CACHE_TS

    if not AUTH0_ISSUER_BASE_URL:
        raise AuthenticationFailed("Auth0 not configured: missing AUTH0_ISSUER_BASE_URL")

    now = time.time()
    if _JWKS_CACHE and (now - _JWKS_CACHE_TS) < _JWKS_TTL_SECONDS:
        return _JWKS_CACHE

    try:
        r = httpx.get(JWKS_URL, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        raise AuthenticationFailed(f"Unable to fetch JWKS: {exc}")

    if not isinstance(data, dict) or "keys" not in data:
        raise AuthenticationFailed("Invalid JWKS payload")

    _JWKS_CACHE = data
    _JWKS_CACHE_TS = now
    return data


def _find_jwk_for_kid(jwks: Dict[str, Any], kid: str) -> Dict[str, Any]:
    keys = jwks.get("keys") or []
    for k in keys:
        if isinstance(k, dict) and k.get("kid") == kid:
            return k
    raise AuthenticationFailed("No matching JWK for token kid")


def _b64url_to_int(val: str) -> int:
    padded = val + "=" * (-len(val) % 4)
    return int.from_bytes(base64.urlsafe_b64decode(padded), "big")


def _jwk_to_public_key(jwk: Dict[str, Any]):
    # Convierte JWK RSA a clave pública usable por python-jose
    from cryptography.hazmat.primitives.asymmetric import rsa

    if jwk.get("kty") != "RSA":
        raise AuthenticationFailed("Unsupported JWK type (expected RSA)")
    if "n" not in jwk or "e" not in jwk:
        raise AuthenticationFailed("Invalid RSA JWK (missing n/e)")

    n = _b64url_to_int(jwk["n"])
    e = _b64url_to_int(jwk["e"])
    public_numbers = rsa.RSAPublicNumbers(e, n)
    return public_numbers.public_key()


@dataclass
class Auth0User:
    """
    Usuario mínimo para DRF, sin DB.
    """
    sub: str
    claims: Dict[str, Any]

    @property
    def is_authenticated(self) -> bool:  # DRF/Django lo consultan
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def username(self) -> str:
        return self.sub


class Auth0JWTAuthentication(BaseAuthentication):
    """
    Valida JWT Access Token emitido por Auth0 (RS256), verificando:
    - signature vía JWKS
    - issuer
    - audience
    """

    def authenticate(self, request) -> Optional[Tuple[Auth0User, Any]]:
        # ✅ DEV: si Auth0 no está configurado, NO explotes; simplemente no autentiques.
        if not AUTH0_ISSUER_BASE_URL or not AUTH0_AUDIENCE:
            if settings.DEBUG:
                return None
            raise AuthenticationFailed(
                "Auth0 not configured. Set AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE."
            )

        token = _get_bearer_token(request)

        try:
            from jose import jwt
        except Exception:
            raise AuthenticationFailed("Missing dependency: python-jose")

        # Header para kid
        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            if not kid:
                raise AuthenticationFailed("Token header missing kid")
        except AuthenticationFailed:
            raise
        except Exception:
            raise AuthenticationFailed("Invalid token header")

        jwks = _get_jwks()
        jwk = _find_jwk_for_kid(jwks, kid)
        public_key = _jwk_to_public_key(jwk)

        # Auth0 suele emitir iss con trailing slash
        expected_issuer = f"{AUTH0_ISSUER_BASE_URL}/"

        try:
            claims = jwt.decode(
                token,
                public_key,
                algorithms=ALGORITHMS,
                audience=AUTH0_AUDIENCE,
                issuer=expected_issuer,
                options={
                    "verify_aud": True,
                    "verify_iss": True,
                    "verify_signature": True,
                },
            )
        except Exception as exc:
            raise AuthenticationFailed(f"Invalid token: {exc}")

        sub = claims.get("sub")
        if not sub:
            raise AuthenticationFailed("Token missing sub")

        user = Auth0User(sub=str(sub), claims=claims)
        request.auth_token = token

        # ✅ IMPORTANTE: devolvemos claims como request.auth para que HasAnyScope funcione
        return (user, claims)


def verify_jwt(token: str):
    """
    Backwards-compatible alias for tests.
    Tests monkeypatch this symbol; keep it stable.
    """
    if "verify_token" in globals():
        return verify_token(token)  # type: ignore[name-defined]
    raise NotImplementedError("verify_jwt is not wired to a real implementation")
