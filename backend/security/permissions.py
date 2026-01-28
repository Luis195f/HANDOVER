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


def RequireRolesPermission(*required_roles: str):
    """
    Factory DRF-safe.
    Uso:
        permission_classes = [IsAuthenticated, RequireRolesPermission("nurse", "admin")]
    """
    required = _normalize_roles(required_roles)

    class _RequireRolesPermission(BasePermission):
        message = "No tienes permisos suficientes."

        def has_permission(self, request, view) -> bool:
            if not required:
                return True

            user = getattr(request, "user", None)
            claims = getattr(user, "claims", None) or getattr(request, "auth", None)

            if not isinstance(claims, dict):
                return False

            user_roles = _extract_roles(claims)
            return bool(user_roles & required)

    return _RequireRolesPermission
