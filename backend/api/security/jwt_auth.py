# api/security/jwt_auth.py
import os
from typing import Any, Dict, Optional, Set

import jwt
from jwt import PyJWKClient

AUTH0_DOMAIN = os.environ["AUTH0_DOMAIN"]
AUTH0_ISSUER = os.environ["AUTH0_ISSUER"].rstrip("/") + "/"
AUTH0_AUDIENCE = os.environ["AUTH0_AUDIENCE"]
ALGORITHMS = os.environ.get("AUTH0_ALGORITHMS", "RS256").split(",")

_jwks = PyJWKClient(f"https://{AUTH0_DOMAIN}/.well-known/jwks.json")

class AuthError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message

def extract_bearer_token(auth_header: Optional[str]) -> str:
    if not auth_header:
        raise AuthError(401, "missing_authorization_header")
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthError(401, "invalid_authorization_header")
    return parts[1].strip()

def verify_jwt(token: str) -> Dict[str, Any]:
    try:
        signing_key = _jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=ALGORITHMS,
            audience=AUTH0_AUDIENCE,
            issuer=AUTH0_ISSUER,
            options={"require": ["exp", "iss", "aud"]},
        )
        return claims
    except jwt.ExpiredSignatureError:
        raise AuthError(401, "token_expired")
    except jwt.InvalidTokenError:
        raise AuthError(401, "invalid_token")

def get_permissions_from_claims(claims: Dict[str, Any]) -> Set[str]:
    # Auth0 puede enviar permissions: [] (RBAC) o scope: "a b c"
    perms = set()
    raw_perms = claims.get("permissions")
    if isinstance(raw_perms, list):
        perms.update([str(p).strip() for p in raw_perms if str(p).strip()])
    raw_scope = claims.get("scope")
    if isinstance(raw_scope, str) and raw_scope.strip():
        perms.update(raw_scope.split())
    return perms
