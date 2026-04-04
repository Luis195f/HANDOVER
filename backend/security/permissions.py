from __future__ import annotations

from typing import Iterable, Set

from rest_framework.permissions import BasePermission


ROLE_CLAIM_KEYS: tuple[str, ...] = (
    "roles",
    "role",
    "permissions",
    "https://handover/roles",
    "https://handover/role",
    "https://handoverpro/roles",
    "https://handoverpro/role",
)


def _normalize_roles(values: Iterable[str]) -> Set[str]:
    sanitized: Set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip().lower()
        if normalized:
            sanitized.add(normalized)
    return sanitized


def _extract_roles(claims: dict) -> Set[str]:
    collected: Set[str] = set()
    for key in ROLE_CLAIM_KEYS:
        raw = claims.get(key)
        if not raw:
            continue
        if isinstance(raw, str):
            collected.update(_normalize_roles(raw.split(",")))
        elif isinstance(raw, (list, tuple, set)):
            collected.update(_normalize_roles([str(item) for item in raw]))
    return collected


class RequireRolesPermission(BasePermission):
    """
    Permiso base DRF-safe para comprobar roles.
    """
    message = "Authenticated user is missing one of the required roles."
    code = "forbidden-role"
    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:
        required = _normalize_roles(self.allowed_roles)
        if not required:
            return True

        user = getattr(request, "user", None)
        claims = getattr(user, "claims", None) or getattr(request, "auth", None)

        if not isinstance(claims, dict):
            return False

        user_roles = _extract_roles(claims)
        return bool(user_roles & required)


class NurseOrAdminPermission(RequireRolesPermission):
    allowed_roles = ("nurse", "admin")


class ClinicianAuditPermission(RequireRolesPermission):
    allowed_roles = ("nurse", "supervisor", "admin")


class IsAdminOrSupervisor(BasePermission):
    """Permite acceso únicamente a usuarios admin o supervisor."""

    message = "Authenticated user requires admin or supervisor role."
    code = "forbidden-role"

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        user_role = getattr(user, "role", None)

        if isinstance(user_role, str):
            normalized_role = user_role.strip().lower()
            if normalized_role in {"admin", "supervisor"}:
                return True

        auth_claims = getattr(request, "auth", None)
        user_claims = getattr(user, "claims", None)

        claims: dict | None = None
        if isinstance(auth_claims, dict):
            claims = auth_claims
        elif isinstance(user_claims, dict):
            claims = user_claims

        if not claims:
            return False

        user_roles = _extract_roles(claims)
        if not user_roles:
            return False

        return bool(user_roles & {"admin", "supervisor"})
