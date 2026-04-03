from __future__ import annotations

from rest_framework.permissions import BasePermission

from backend.security.roles import extract_roles


class HasAnyRole(BasePermission):
    message = "Authenticated user is missing one of the required roles."
    code = "forbidden-role"
    required_roles: set[str] = set()

    def has_permission(self, request, view) -> bool:
        # Si la vista NO exige roles específicos, no bloqueamos.
        if not self.required_roles:
            return True

        # claims vienen típicamente en request.auth (si Auth0JWTAuthentication retorna (user, claims))
        claims = None
        if hasattr(request, "auth") and isinstance(request.auth, dict):
            claims = request.auth
        else:
            user = getattr(request, "user", None)
            claims = getattr(user, "claims", None)

        if not isinstance(claims, dict):
            return False

        user_roles = extract_roles(claims)

        # ✅ Hardening: si no hay roles en el token, DENY (evita default-allow por tokens incompletos)
        if not user_roles:
            return False

        return bool(user_roles & self.required_roles)

    @staticmethod
    def required(*roles: str):
        # Subclase “inmutable” por combinación de roles (como ya lo haces)
        subclass = type(
            f"{HasAnyRole.__name__}__{abs(hash(roles))}",
            (HasAnyRole,),
            {},
        )
        subclass.required_roles = {
            r.strip().lower()
            for r in roles
            if isinstance(r, str) and r.strip()
        }
        return subclass
