from __future__ import annotations

from typing import Iterable, Set

from rest_framework.permissions import BasePermission


ROLE_CLAIM_KEYS: tuple[str, ...] = (
    "roles",
    "role",
    "https://handover/roles",
    "https://handover/role",
    "https://handoverpro/roles",
    "https://handoverpro/role",
)


def _normalize_roles(values: Iterable[str]) -> Set[str]:
    sanitized: Set[str] = set()
    for value in values:
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
        elif isinstance(raw, (list, tuple)):
            collected.update(_normalize_roles([str(item) for item in raw]))
    return collected


class RequireRolesPermission(BasePermission):
    """
    Permite el acceso si el JWT contiene alguno de los roles requeridos.
    """

    message = "Forbidden"

    def __init__(self, *required_roles: str) -> None:
        self.required_roles = _normalize_roles(required_roles)

    def has_permission(self, request, view) -> bool:
        if not self.required_roles:
            return True

        user = getattr(request, "user", None)
        claims = getattr(user, "claims", None)
        if not isinstance(claims, dict):
            return False

        user_roles = _extract_roles(claims)
        return bool(user_roles & self.required_roles)
