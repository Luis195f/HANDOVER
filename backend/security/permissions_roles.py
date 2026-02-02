from __future__ import annotations

from rest_framework.permissions import BasePermission

from backend.security.roles import extract_roles


class HasAnyRole(BasePermission):
    message = "No tienes permisos suficientes."
    required_roles: set[str] = set()

    def has_permission(self, request, view) -> bool:
        if not self.required_roles:
            return True
        claims = None
        if hasattr(request, "auth") and isinstance(request.auth, dict):
            claims = request.auth
        else:
            user = getattr(request, "user", None)
            claims = getattr(user, "claims", None)
        if not isinstance(claims, dict):
            return False
        user_roles = extract_roles(claims)
        return bool(user_roles & self.required_roles)

    @staticmethod
    def required(*roles: str):
        subclass = type(f"{HasAnyRole.__name__}__{abs(hash(roles))}", (HasAnyRole,), {})
        subclass.required_roles = {r.strip().lower() for r in roles if isinstance(r, str) and r.strip()}
        return subclass
