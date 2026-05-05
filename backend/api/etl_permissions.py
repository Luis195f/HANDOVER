from __future__ import annotations

from rest_framework.permissions import BasePermission

from backend.api.etl_access import (
    has_bearer_authorization,
    has_client_credentials_grant,
    has_valid_etl_access,
)
from backend.security.auth import AuthRequired


class ClientCredentialsEtlPermission(BasePermission):
    message = "Forbidden"
    code = "forbidden-scope"

    def has_permission(self, request, view) -> bool:
        if not has_bearer_authorization(request):
            raise AuthRequired()

        if not has_client_credentials_grant(request):
            self.message = "Forbidden"
            self.code = "forbidden-grant-type"
            return False

        if not has_valid_etl_access(request):
            self.message = "Forbidden"
            self.code = "forbidden-scope"
            return False

        return True
