from __future__ import annotations

from typing import Any

from django.http import HttpRequest

from backend.security.roles import extract_roles
from backend.security.scope_permissions import _extract_permissions_from_request


ETL_ALLOWED_ROLES = {"service_etl", "admin"}
ETL_REQUIRED_SCOPES = {"icea:etl:read", "handover:etl:read"}


def get_claims_from_request(request: HttpRequest) -> dict[str, Any] | None:
    """Extrae claims ya validados del request sin acoplarse a views.py."""
    auth_claims = getattr(request, "auth", None)
    if isinstance(auth_claims, dict):
        return auth_claims

    user = getattr(request, "user", None)
    user_claims = getattr(user, "claims", None)
    if isinstance(user_claims, dict):
        return user_claims

    if isinstance(user, dict):
        return user

    if hasattr(user, "claims") and isinstance(user.claims, dict):
        return user.claims

    return None


def has_bearer_authorization(request: HttpRequest) -> bool:
    auth_header = str(request.META.get("HTTP_AUTHORIZATION") or "").strip().lower()
    return auth_header.startswith("bearer ")


def has_client_credentials_grant(request: HttpRequest) -> bool:
    claims = get_claims_from_request(request) or {}
    grant_type = str((claims.get("gty") if isinstance(claims, dict) else "") or "").strip().lower()
    return grant_type == "client-credentials"


def has_valid_etl_access(request: HttpRequest) -> bool:
    claims = get_claims_from_request(request) or {}
    roles = extract_roles(claims) if isinstance(claims, dict) else set()
    if not (roles & ETL_ALLOWED_ROLES):
        return False

    scopes = set(_extract_permissions_from_request(request) or [])
    return bool(scopes & ETL_REQUIRED_SCOPES)
