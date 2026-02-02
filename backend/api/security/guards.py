# api/security/guards.py
from functools import wraps
from typing import Callable, Iterable

from .jwt_auth import AuthError, extract_bearer_token, verify_jwt, get_permissions_from_claims

def require_permissions(required: Iterable[str]):
    required_set = set(required)

    def decorator(view_func: Callable):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            token = extract_bearer_token(request.headers.get("Authorization"))
            claims = verify_jwt(token)
            perms = get_permissions_from_claims(claims)

            if not required_set.issubset(perms):
                raise AuthError(403, "insufficient_permissions")

            # adjunta al request (server-trust)
            request.auth_claims = claims
            request.auth_permissions = perms
            return view_func(request, *args, **kwargs)

        return wrapper
    return decorator
