# backend/security/scope_permissions.py
from typing import Set, Optional, Any
from rest_framework.permissions import BasePermission
from rest_framework.request import Request


def _get_claims_from_request(request: Request) -> Optional[dict]:
    """
    Intenta extraer claims JWT desde los lugares típicos de DRF/Auth backends:
      1) request.user.claims  (tu Auth0JWTAuthentication devuelve Auth0User con .claims)
      2) request.auth         (algunos backends colocan dict de claims aquí)
      3) request.user         (fallback si user fuera dict)
    """
    # 1) Tu caso real: request.user es Auth0User con atributo .claims (dict)
    user = getattr(request, "user", None)
    claims = getattr(user, "claims", None)
    if isinstance(claims, dict):
        return claims

    # 2) Otros backends: request.auth puede ser dict de claims
    auth = getattr(request, "auth", None)
    if isinstance(auth, dict):
        return auth

    # 3) Fallback: a veces user podría ser dict
    if isinstance(user, dict):
        return user

    return None


def _extract_permissions_from_request(request: Request) -> Set[str]:
    """
    Auth0 puede entregar permisos/scopes como:
      - permissions: ["handover:read", ...]
      - scope: "openid profile email handover:read"
    También soportamos 'scp' (algunos emisores/SDKs lo usan).
    """
    perms: Set[str] = set()
    claims = _get_claims_from_request(request)

    if not isinstance(claims, dict):
        return perms

    # 1) permissions: ["a", "b"]
    raw_permissions = claims.get("permissions")
    if isinstance(raw_permissions, list):
        for p in raw_permissions:
            s = str(p).strip()
            if s:
                perms.add(s)

    # 2) scope: "a b c"
    raw_scope = claims.get("scope")
    if isinstance(raw_scope, str) and raw_scope.strip():
        for s in raw_scope.split():
            s = s.strip()
            if s:
                perms.add(s)

    # 3) scp: ["a","b"] o "a b" (fallback defensivo)
    raw_scp = claims.get("scp")
    if isinstance(raw_scp, list):
        for p in raw_scp:
            s = str(p).strip()
            if s:
                perms.add(s)
    elif isinstance(raw_scp, str) and raw_scp.strip():
        for s in raw_scp.split():
            s = s.strip()
            if s:
                perms.add(s)

    return perms


class HasAnyScope(BasePermission):
    """
    Permite acceso si el token contiene AL MENOS UNO de los scopes requeridos.

    Uso:
      permission_classes = [IsAuthenticated, HasAnyScope.required("patients:read")]
    """

    required_scopes: Set[str] = set()
    message = "Authenticated user is missing one of the required scopes."
    code = "forbidden-scope"

    def has_permission(self, request: Request, view) -> bool:
        token_scopes = _extract_permissions_from_request(request)
        if not self.required_scopes:
            return True
        return any(scope in token_scopes for scope in self.required_scopes)

    @classmethod
    def required(cls, *scopes: str):
        subclass = type(f"{cls.__name__}__{abs(hash(scopes))}", (cls,), {})
        subclass.required_scopes = {s.strip() for s in scopes if isinstance(s, str) and s.strip()}
        return subclass


class HasAllScopes(BasePermission):
    """
    Permite acceso si el token contiene TODOS los scopes requeridos.
    """

    required_scopes: Set[str] = set()
    message = "Authenticated user is missing one of the required scopes."
    code = "forbidden-scope"

    def has_permission(self, request: Request, view) -> bool:
        token_scopes = _extract_permissions_from_request(request)
        if not self.required_scopes:
            return True
        return self.required_scopes.issubset(token_scopes)

    @classmethod
    def required(cls, *scopes: str):
        subclass = type(f"{cls.__name__}__{abs(hash(scopes))}", (cls,), {})
        subclass.required_scopes = {s.strip() for s in scopes if isinstance(s, str) and s.strip()}
        return subclass
