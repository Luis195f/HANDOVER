from __future__ import annotations

from typing import Iterable, Set


ROLE_CLAIM_KEYS: tuple[str, ...] = (
    "roles",
    "role",
    "https://handover/roles",
    "https://handoverpro/roles",
)


def _normalize_roles(values: Iterable[str]) -> Set[str]:
    normalized: Set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip().lower()
        if cleaned:
            normalized.add(cleaned)
    return normalized


def extract_roles(claims: dict) -> Set[str]:
    """
    Extrae roles desde claims JWT soportando keys conocidas.
    Nunca lanza excepción: si no hay roles -> set vacío.
    """
    if not isinstance(claims, dict):
        return set()

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
