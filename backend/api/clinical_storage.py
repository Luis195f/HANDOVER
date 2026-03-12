from __future__ import annotations

import base64
import json
import os
from hashlib import sha256
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings

from backend.audit.utils import canonical_json


ENCRYPTED_BUNDLE_MARKER = "handover_bundle_encrypted_v1"
AES_GCM_NONCE_BYTES = 12
KEY_SOURCE_ENV = "env"
KEY_SOURCE_SECRET_KEY_DERIVED = "secret_key_derived"


class ClinicalBundleStorageError(Exception):
    pass


def _key_material() -> tuple[bytes, str]:
    configured = (getattr(settings, "HANDOVER_BUNDLE_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        return configured.encode("utf-8"), KEY_SOURCE_ENV
    return settings.SECRET_KEY.encode("utf-8"), KEY_SOURCE_SECRET_KEY_DERIVED


def _key_material_for_source(key_source: str) -> bytes | None:
    normalized = str(key_source or "").strip()
    if normalized == KEY_SOURCE_ENV:
        configured = (getattr(settings, "HANDOVER_BUNDLE_ENCRYPTION_KEY", "") or "").strip()
        return configured.encode("utf-8") if configured else None
    if normalized == KEY_SOURCE_SECRET_KEY_DERIVED:
        return settings.SECRET_KEY.encode("utf-8")
    return None


def _bundle_key() -> tuple[bytes, str]:
    material, key_source = _key_material()
    digest = sha256(b"handover-clinical-bundle-v1\x00" + material).digest()
    return digest, key_source


def _bundle_key_for_source(key_source: str) -> tuple[bytes, str] | None:
    material = _key_material_for_source(key_source)
    if material is None:
        return None
    normalized = str(key_source or "").strip()
    digest = sha256(b"handover-clinical-bundle-v1\x00" + material).digest()
    return digest, normalized


def _decrypt_key_candidates(encryption_metadata: Any) -> list[tuple[bytes, str]]:
    candidates: list[tuple[bytes, str]] = []
    seen_sources: set[str] = set()
    metadata_key_source = None
    if isinstance(encryption_metadata, dict):
        raw_key_source = encryption_metadata.get("key_source")
        if isinstance(raw_key_source, str) and raw_key_source.strip():
            metadata_key_source = raw_key_source.strip()

    for candidate_source in (
        metadata_key_source,
        _key_material()[1],
        KEY_SOURCE_ENV,
        KEY_SOURCE_SECRET_KEY_DERIVED,
    ):
        if not isinstance(candidate_source, str) or candidate_source in seen_sources:
            continue
        candidate = _bundle_key_for_source(candidate_source)
        if candidate is None:
            continue
        key, normalized_source = candidate
        candidates.append((key, normalized_source))
        seen_sources.add(normalized_source)
    return candidates


def is_encrypted_bundle_payload(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("_storage") == ENCRYPTED_BUNDLE_MARKER
        and isinstance(value.get("nonce"), str)
        and isinstance(value.get("ciphertext"), str)
    )


def encrypt_bundle_document(bundle: dict[str, Any]) -> tuple[dict[str, str | int], dict[str, Any]]:
    key, key_source = _bundle_key()
    plaintext = canonical_json(bundle)
    nonce = os.urandom(AES_GCM_NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    payload_hash = sha256(plaintext).hexdigest()
    envelope = {
        "_storage": ENCRYPTED_BUNDLE_MARKER,
        "v": 1,
        "alg": "AES-256-GCM",
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }
    metadata = {
        "at_rest": "application-aes-256-gcm",
        "key_source": key_source,
        "storage": "encrypted-envelope",
        "sha256": payload_hash,
    }
    return envelope, metadata


def decrypt_bundle_document(value: Any, *, encryption_metadata: Any = None) -> dict[str, Any]:
    if not is_encrypted_bundle_payload(value):
        if isinstance(value, dict):
            return value
        raise ClinicalBundleStorageError("Persisted handover bundle is not a JSON object.")

    try:
        nonce = base64.b64decode(str(value["nonce"]))
        ciphertext = base64.b64decode(str(value["ciphertext"]))
    except Exception as exc:  # pragma: no cover - defensive branch
        raise ClinicalBundleStorageError("Unable to decrypt persisted handover bundle.") from exc

    plaintext = None
    last_exc: Exception | None = None
    for key, _key_source in _decrypt_key_candidates(encryption_metadata):
        try:
            plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
            break
        except Exception as exc:  # pragma: no cover - defensive branch
            last_exc = exc

    if plaintext is None:
        raise ClinicalBundleStorageError("Unable to decrypt persisted handover bundle.") from last_exc

    try:
        payload = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:  # pragma: no cover - defensive branch
        raise ClinicalBundleStorageError("Persisted handover bundle is not valid JSON.") from exc

    if not isinstance(payload, dict):
        raise ClinicalBundleStorageError("Persisted handover bundle is not a JSON object.")
    return payload

