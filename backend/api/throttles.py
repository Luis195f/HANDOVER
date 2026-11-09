"""Per-operation API quotas; the default Django cache is process-local unless deployed otherwise."""

from hashlib import sha256

from rest_framework.exceptions import APIException
from rest_framework.throttling import SimpleRateThrottle

from backend.audit.middleware import AuditRequestMiddleware


class AudioRequestTooLarge(APIException):
    status_code = 413
    default_detail = "Audio request exceeds the configured size limit."
    default_code = "audio_request_too_large"


class _OperationThrottle(SimpleRateThrottle):
    def get_rate(self):
        return self.rate

    def _cache_key(self, identity):
        digest = sha256(identity.encode("utf-8")).hexdigest()
        return f"throttle_{self.scope}_{digest}"


class _AuthenticatedWriteThrottle(_OperationThrottle):
    def get_cache_key(self, request, view):
        if request.method != "POST":
            return None
        user = request.user
        sub = getattr(user, "sub", None) if getattr(user, "is_authenticated", False) else None
        return self._cache_key(sub) if isinstance(sub, str) and sub else None


class SensitiveWriteThrottle(_AuthenticatedWriteThrottle):
    scope = "sensitive_write"
    rate = "120/min"


class AISuggestionThrottle(_AuthenticatedWriteThrottle):
    scope = "ai_suggestion"
    rate = "60/min"


class AudioThrottle(_AuthenticatedWriteThrottle):
    scope = "audio_upload"
    rate = "60/min"

    def allow_request(self, request, view):
        if request.method == "POST":
            # Content-Length can bound the whole request before multipart parsing;
            # the existing file-size check still validates the parsed upload.
            from backend.api.views_ai import HANDOVER_MAX_AUDIO_BYTES

            raw_length = request.META.get("CONTENT_LENGTH", "")
            try:
                body_length = int(raw_length)
            except (TypeError, ValueError):
                body_length = 0
            if body_length > HANDOVER_MAX_AUDIO_BYTES + 65536:
                raise AudioRequestTooLarge()
        return super().allow_request(request, view)


class RefreshThrottle(_OperationThrottle):
    scope = "oauth_refresh"
    rate = "10/min"

    def get_cache_key(self, request, view):
        if request.method != "POST":
            return None
        origin = getattr(request, "audit_client_ip", "") or AuditRequestMiddleware._get_client_ip(request)
        return self._cache_key(origin or "unknown")
