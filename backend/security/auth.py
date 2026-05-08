# backend/security/auth.py
from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated

ALGORITHMS = ["RS256"]

# Cache JWKS particionado por issuer/JWKS URL para evitar contaminación cruzada.
_JWKS_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}
_JWKS_CACHE_TS: Dict[Tuple[str, str], float] = {}
_JWKS_TTL_SECONDS = 3600


class AuthRequired(NotAuthenticated):
    default_detail = "Authentication credentials were not provided."
    default_code = "auth-required"


class AuthFailed(AuthenticationFailed):
    default_detail = "Authentication failed."
    default_code = "auth-failed"


def _auth0_issuer_base_url() -> str:
    return str(getattr(settings, "AUTH0_ISSUER_BASE_URL", "") or "").rstrip("/")


def _auth0_audience() -> str:
    return str(getattr(settings, "AUTH0_AUDIENCE", "") or "")


def _local_auth_bypass_allowed() -> bool:
    return bool(getattr(settings, "HANDOVER_LOCAL_AUTH_BYPASS_ALLOWED", False)) and not bool(
        getattr(settings, "AUTH0_CONFIGURED", False)
    )


def _jwks_url() -> str:
    return f"{_auth0_issuer_base_url()}/.well-known/jwks.json"


def _jwks_cache_key() -> Tuple[str, str]:
    issuer_base_url = _auth0_issuer_base_url()
    return (issuer_base_url, _jwks_url())


def _get_bearer_token(request) -> str:
    auth = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth:
        raise AuthRequired()

    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthFailed("Invalid Authorization header (expected: Bearer <token>)")

    return parts[1]


def verify_jwt(token: str) -> Dict[str, Any]:
    """
    Alias de compatibilidad para tests/consumidores que monkeypatchan
    ``backend.security.auth.verify_jwt``.

    No forma parte del flujo real de autenticación. La validación JWT activa
    sigue en ``Auth0JWTAuthentication.authenticate()``.
    """
    raise NotImplementedError(
        "backend.security.auth.verify_jwt is a compatibility alias for tests only; real authentication lives in Auth0JWTAuthentication.authenticate()."
    )


def _get_jwks() -> Dict[str, Any]:
    global _JWKS_CACHE, _JWKS_CACHE_TS

    issuer_base_url = _auth0_issuer_base_url()
    if not issuer_base_url:
        raise AuthFailed("Auth0 not configured: missing AUTH0_ISSUER_BASE_URL")

    cache_key = _jwks_cache_key()
    now = time.time()
    cached = _JWKS_CACHE.get(cache_key)
    cached_at = _JWKS_CACHE_TS.get(cache_key)
    if cached and cached_at is not None and (now - cached_at) < _JWKS_TTL_SECONDS:
        return cached

    try:
        r = httpx.get(_jwks_url(), timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception:
        # Mensaje neutro (evita filtrar detalles internos)
        raise AuthFailed("Unable to fetch JWKS")

    if not isinstance(data, dict) or "keys" not in data:
        raise AuthFailed("Invalid JWKS payload")

    _JWKS_CACHE[cache_key] = data
    _JWKS_CACHE_TS[cache_key] = now
    return data


def _find_jwk_for_kid(jwks: Dict[str, Any], kid: str) -> Dict[str, Any]:
    keys = jwks.get("keys") or []
    for k in keys:
        if isinstance(k, dict) and k.get("kid") == kid:
            return k
    raise AuthFailed("No matching JWK for token kid")


def _b64url_to_int(val: str) -> int:
    padded = val + "=" * (-len(val) % 4)
    return int.from_bytes(base64.urlsafe_b64decode(padded), "big")


def _jwk_to_public_key(jwk: Dict[str, Any]):
    from cryptography.hazmat.primitives.asymmetric import rsa

    if jwk.get("kty") != "RSA":
        raise AuthFailed("Unsupported JWK type (expected RSA)")
    if "n" not in jwk or "e" not in jwk:
        raise AuthFailed("Invalid RSA JWK (missing n/e)")

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
        token = _get_bearer_token(request)
        issuer_base_url = _auth0_issuer_base_url()
        audience = _auth0_audience()

        # Local-only escape hatch: serious envs must fail closed when Auth0 is missing.
        if not issuer_base_url or not audience:
            if _local_auth_bypass_allowed():
                return None
            raise AuthFailed(
                "Auth0 not configured. Set AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE."
            )

        try:
            from jose import jwt
        except Exception:
            raise AuthFailed("Missing dependency: python-jose")

        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            if not kid:
                raise AuthFailed("Token header missing kid")
        except (AuthenticationFailed, NotAuthenticated):
            raise
        except Exception:
            raise AuthFailed("Invalid token header")

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
            raise AuthFailed("Invalid token")

        sub = claims.get("sub")
        if not sub:
            raise AuthFailed("Token missing sub")

        user = Auth0User(sub=str(sub), claims=claims)
        request.auth_token = token

        # ✅ devolvemos claims como request.auth para scopes/roles
        return (user, claims)

    def authenticate_header(self, request) -> str:
        return "Bearer"

