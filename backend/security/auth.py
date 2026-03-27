# backend/security/auth.py
from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

ALGORITHMS = ["RS256"]

# Cache simple de JWKS
_JWKS_CACHE: Optional[Dict[str, Any]] = None
_JWKS_CACHE_TS: float = 0.0
_JWKS_TTL_SECONDS = 3600


def _auth0_issuer_base_url() -> str:
    return str(getattr(settings, "AUTH0_ISSUER_BASE_URL", "") or "").rstrip("/")


def _auth0_audience() -> str:
    return str(getattr(settings, "AUTH0_AUDIENCE", "") or "")


def _jwks_url() -> str:
    return f"{_auth0_issuer_base_url()}/.well-known/jwks.json"


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

    issuer_base_url = _auth0_issuer_base_url()
    if not issuer_base_url:
        raise AuthenticationFailed("Auth0 not configured: missing AUTH0_ISSUER_BASE_URL")

    now = time.time()
    if _JWKS_CACHE and (now - _JWKS_CACHE_TS) < _JWKS_TTL_SECONDS:
        return _JWKS_CACHE

    try:
        r = httpx.get(_jwks_url(), timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception:
        # Mensaje neutro (evita filtrar detalles internos)
        raise AuthenticationFailed("Unable to fetch JWKS")

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
    """Usuario mínimo para DRF, sin DB."""
    sub: str
    claims: Dict[str, Any]

    @property
    def is_authenticated(self) -> bool:
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
        issuer_base_url = _auth0_issuer_base_url()
        audience = _auth0_audience()

        # Local-only escape hatch: tests bypass this authenticator upstream and
        # DEBUG preserves the explicit dev contract without opening serious envs.
        if not issuer_base_url or not audience:
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

        expected_issuer = f"{issuer_base_url}/"

        try:
            claims = jwt.decode(
                token,
                public_key,
                algorithms=ALGORITHMS,
                audience=audience,
                issuer=expected_issuer,
                options={
                    "verify_aud": True,
                    "verify_iss": True,
                    "verify_signature": True,
                },
            )
        except Exception:
            raise AuthenticationFailed("Invalid token")

        sub = claims.get("sub")
        if not sub:
            raise AuthenticationFailed("Token missing sub")

        user = Auth0User(sub=str(sub), claims=claims)
        request.auth_token = token

        # ✅ devolvemos claims como request.auth para scopes/roles
        return (user, claims)

    def authenticate_header(self, request) -> str:
        return "Bearer"


def verify_jwt(token: str):
    """
    Backwards-compatible alias for tests.
    Tests monkeypatch this symbol; keep it stable.
    """
    if "verify_token" in globals():
        return verify_token(token)  # type: ignore[name-defined]
    raise NotImplementedError("verify_jwt is not wired to a real implementation")

