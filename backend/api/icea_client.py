import hmac
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from urllib.parse import urlparse

import httpx
from django.conf import settings

from backend.audit.utils import canonical_json


logger = logging.getLogger(__name__)
DEFAULT_RETRYABLE_HTTP_STATUS_CODES = frozenset({408, 409, 425, 429, 500, 502, 503, 504})


def _post_to_icea(*args, **kwargs):
    return httpx.post(*args, **kwargs)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _running_tests() -> bool:
    return bool(
        getattr(settings, "RUNNING_TESTS", False)
        or os.environ.get("PYTEST_CURRENT_TEST")
        or "pytest" in sys.argv
        or "test" in sys.argv
    )


def _is_secure_or_local(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return True
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}


def _parse_retryable_status_codes(value: str | None) -> frozenset[int]:
    if not value:
        return DEFAULT_RETRYABLE_HTTP_STATUS_CODES

    parsed: set[int] = set()
    for part in value.split(","):
        candidate = part.strip()
        if not candidate:
            continue
        try:
            status_code = int(candidate)
        except ValueError:
            continue
        if 100 <= status_code <= 599:
            parsed.add(status_code)
    return frozenset(parsed or DEFAULT_RETRYABLE_HTTP_STATUS_CODES)


@dataclass(frozen=True)
class IceaWebhookSettings:
    enabled: bool
    url: str
    secret: str
    timeout_ms: int
    retry_max: int
    anti_replay: bool
    replay_window_seconds: int
    retryable_status_codes: frozenset[int]
    validation_errors: tuple[str, ...] = ()

    @property
    def configured(self) -> bool:
        return self.enabled and not self.validation_errors

    @property
    def primary_error(self) -> str:
        return self.validation_errors[0] if self.validation_errors else ""


@dataclass(frozen=True)
class IceaPreparedRequest:
    url: str
    raw_body: bytes
    headers: dict[str, str]
    timeout_seconds: float
    idempotency_key: str


@dataclass(frozen=True)
class IceaClientResponse:
    status_code: int
    latency_ms: int
    body_json: dict[str, Any] | list[Any] | None
    safe_detail: str


class IceaClientError(Exception):
    def __init__(self, detail: str, *, retryable: bool, http_status: int | None = None):
        super().__init__(detail)
        self.detail = detail
        self.retryable = retryable
        self.http_status = http_status


class IceaClientConfigurationError(IceaClientError):
    def __init__(self, detail: str):
        super().__init__(detail, retryable=True, http_status=None)


class IceaTransportError(IceaClientError):
    pass


class IceaHTTPStatusError(IceaClientError):
    pass


def load_icea_webhook_settings() -> IceaWebhookSettings:
    enabled = _env_bool("ICEA_WEBHOOK_ENABLED", False)
    url = (os.getenv("ICEA_WEBHOOK_URL") or "").strip()
    secret = (os.getenv("ICEA_WEBHOOK_SECRET") or "").strip()
    timeout_ms = max(_env_int("ICEA_WEBHOOK_TIMEOUT_MS", 2500), 100)
    retry_max = max(_env_int("ICEA_WEBHOOK_RETRY_MAX", 5), 1)
    anti_replay = _env_bool("ICEA_WEBHOOK_ANTI_REPLAY", False)
    replay_window_seconds = max(_env_int("ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS", 300), 1)
    retryable_status_codes = _parse_retryable_status_codes(os.getenv("ICEA_WEBHOOK_RETRYABLE_STATUS_CODES"))

    if not enabled:
        return IceaWebhookSettings(
            enabled=False,
            url=url,
            secret=secret,
            timeout_ms=timeout_ms,
            retry_max=retry_max,
            anti_replay=anti_replay,
            replay_window_seconds=replay_window_seconds,
            retryable_status_codes=retryable_status_codes,
        )

    errors: list[str] = []
    if not url:
        errors.append("missing_webhook_url")
    elif not _is_secure_or_local(url):
        if settings.DEBUG or _running_tests():
            logger.warning("ICEA_WEBHOOK_URL is not HTTPS; skipping strict enforcement in dev/tests.")
        else:
            errors.append("webhook_url_https_required")

    if not secret:
        errors.append("missing_webhook_secret")
    elif len(secret) < 8:
        errors.append("webhook_secret_too_short")

    return IceaWebhookSettings(
        enabled=enabled,
        url=url,
        secret=secret,
        timeout_ms=timeout_ms,
        retry_max=retry_max,
        anti_replay=anti_replay,
        replay_window_seconds=replay_window_seconds,
        retryable_status_codes=retryable_status_codes,
        validation_errors=tuple(errors),
    )


def build_icea_webhook_body(payload: dict[str, Any]) -> bytes:
    return canonical_json(payload)


def build_icea_signature_headers(
    raw_body: bytes,
    *,
    secret: str,
    anti_replay: bool,
    idempotency_key: str,
    timestamp: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    signature_input = raw_body
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }
    if anti_replay:
        signed_timestamp = timestamp or str(int(time.time()))
        signed_nonce = nonce or str(uuid.uuid4())
        signature_input = f"{signed_timestamp}.{signed_nonce}.".encode("utf-8") + raw_body
        headers["X-ICEA-Timestamp"] = signed_timestamp
        headers["X-ICEA-Nonce"] = signed_nonce

    digest = hmac.new(secret.encode("utf-8"), signature_input, sha256).hexdigest()
    headers["X-ICEA-Signature"] = f"sha256={digest}"
    return headers


def prepare_icea_request(
    payload: dict[str, Any],
    *,
    settings_obj: IceaWebhookSettings,
    idempotency_key: str,
    timestamp: str | None = None,
    nonce: str | None = None,
) -> IceaPreparedRequest:
    if not settings_obj.enabled:
        raise IceaClientConfigurationError("webhook_disabled")
    if settings_obj.validation_errors:
        raise IceaClientConfigurationError(settings_obj.primary_error)

    raw_body = build_icea_webhook_body(payload)
    headers = build_icea_signature_headers(
        raw_body,
        secret=settings_obj.secret,
        anti_replay=settings_obj.anti_replay,
        idempotency_key=idempotency_key,
        timestamp=timestamp,
        nonce=nonce,
    )
    return IceaPreparedRequest(
        url=settings_obj.url,
        raw_body=raw_body,
        headers=headers,
        timeout_seconds=max(settings_obj.timeout_ms / 1000.0, 0.1),
        idempotency_key=idempotency_key,
    )


def _extract_safe_detail_from_json(body_json: dict[str, Any] | list[Any] | None) -> str:
    if isinstance(body_json, dict):
        for key in ("code", "error", "detail", "message", "status"):
            value = body_json.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:255]
            if isinstance(value, (int, float)):
                return str(value)
    return ""


def _parse_response_body(response: httpx.Response) -> dict[str, Any] | list[Any] | None:
    if response.status_code == 204:
        return None

    content_type = str(response.headers.get("Content-Type") or "").lower()
    raw_text = response.text.strip()
    if not raw_text:
        return None
    if "json" not in content_type and not raw_text.startswith("{") and not raw_text.startswith("["):
        return None
    try:
        parsed = response.json()
    except ValueError:
        return None
    if isinstance(parsed, (dict, list)):
        return parsed
    return None


def _status_detail(status_code: int, body_json: dict[str, Any] | list[Any] | None) -> str:
    return _extract_safe_detail_from_json(body_json) or f"http_{status_code}"


def send_icea_webhook(
    payload: dict[str, Any],
    *,
    settings_obj: IceaWebhookSettings,
    idempotency_key: str,
) -> IceaClientResponse:
    prepared = prepare_icea_request(payload, settings_obj=settings_obj, idempotency_key=idempotency_key)
    start = time.monotonic()

    try:
        response = _post_to_icea(
            prepared.url,
            content=prepared.raw_body,
            headers=prepared.headers,
            timeout=prepared.timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise IceaTransportError(exc.__class__.__name__, retryable=True) from exc

    latency_ms = int((time.monotonic() - start) * 1000)
    body_json = _parse_response_body(response)

    if 200 <= response.status_code < 300:
        return IceaClientResponse(
            status_code=response.status_code,
            latency_ms=latency_ms,
            body_json=body_json,
            safe_detail="ok",
        )

    safe_detail = _status_detail(response.status_code, body_json)
    raise IceaHTTPStatusError(
        safe_detail,
        retryable=response.status_code in settings_obj.retryable_status_codes,
        http_status=response.status_code,
    )
