import os
import time
from types import SimpleNamespace
from typing import Any, Dict, Iterable, Optional

import httpx
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin
from jose import JWTError, jwk, jwt

JWKS_CACHE: Optional[Dict[str, Any]] = None
JWKS_CACHED_AT: Optional[float] = None
JWKS_TTL_SECONDS = 3600

PROTECTED_PATH_PREFIXES: Iterable[str] = ('/api/fhir/',)


def _get_env(name: str) -> Optional[str]:
    return os.environ.get(name)


def _fetch_discovery_jwks_uri(issuer: str) -> Optional[str]:
    try:
        resp = httpx.get(f"{issuer.rstrip('/')}/.well-known/openid-configuration", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        jwks_uri = data.get('jwks_uri')
        return jwks_uri if isinstance(jwks_uri, str) else None
    except (httpx.HTTPError, ValueError):
        return None


def _load_jwks() -> Dict[str, Any]:
    global JWKS_CACHE, JWKS_CACHED_AT
    issuer = _get_env('OIDC_ISSUER')
    jwks_uri = _get_env('OIDC_JWKS_URI')
    if JWKS_CACHE and JWKS_CACHED_AT and (time.time() - JWKS_CACHED_AT) < JWKS_TTL_SECONDS:
        return JWKS_CACHE

    if not jwks_uri and issuer:
        jwks_uri = _fetch_discovery_jwks_uri(issuer)

    if not jwks_uri:
        raise RuntimeError('OIDC_JWKS_URI is not configured')

    resp = httpx.get(jwks_uri, timeout=10)
    resp.raise_for_status()
    JWKS_CACHE = resp.json()
    JWKS_CACHED_AT = time.time()
    return JWKS_CACHE


def _find_jwk_for_token(token: str, jwks_set: Dict[str, Any]) -> Dict[str, Any]:
    unverified = jwt.get_unverified_header(token)
    kid = unverified.get('kid')
    keys = jwks_set.get('keys') or []
    for key in keys:
        if key.get('kid') == kid:
            return key
    raise JWTError('Matching JWK not found')


def verify_jwt_token(token: str) -> Dict[str, Any]:
    issuer = _get_env('OIDC_ISSUER')
    audience = _get_env('OIDC_AUDIENCE')
    jwks_set = _load_jwks()
    key = _find_jwk_for_token(token, jwks_set)

    algorithm = key.get('alg') or 'RS256'
    return jwt.decode(
        token,
        jwk.construct(key),
        algorithms=[algorithm],
        audience=audience,
        issuer=issuer,
        options={'verify_aud': bool(audience)},
    )


def reset_jwks_cache():
    global JWKS_CACHE, JWKS_CACHED_AT
    JWKS_CACHE = None
    JWKS_CACHED_AT = None


class JwtAuthenticationMiddleware(MiddlewareMixin):
    def process_request(self, request):
        if not any(request.path.startswith(prefix) for prefix in PROTECTED_PATH_PREFIXES):
            return None

        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header or not auth_header.lower().startswith('bearer '):
            return JsonResponse({'detail': 'Authentication credentials were not provided.'}, status=401)

        token = auth_header.split(' ', 1)[1].strip()
        try:
            claims = verify_jwt_token(token)
        except Exception as exc:  # noqa: BLE001
            return JsonResponse({'detail': 'Invalid token', 'error': str(exc)}, status=401)

        request.user = SimpleNamespace(**claims)
        request.auth = claims
        request.claims = claims
        return None
