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


class ClinicalBundleStorageError(Exception):
    pass


def _key_material() -> tuple[bytes, str]:
    configured = (getattr(settings, "HANDOVER_BUNDLE_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        return configured.encode("utf-8"), "env"
    return settings.SECRET_KEY.encode("utf-8"), "secret_key_derived"


def _bundle_key() -> tuple[bytes, str]:
    material, key_source = _key_material()
    digest = sha256(b"handover-clinical-bundle-v1\x00" + material).digest()
    return digest, key_source


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


def decrypt_bundle_document(value: Any) -> dict[str, Any]:
    if not is_encrypted_bundle_payload(value):
        if isinstance(value, dict):
            return value
        raise ClinicalBundleStorageError("Persisted handover bundle is not a JSON object.")

    key, _key_source = _bundle_key()
    try:
        nonce = base64.b64decode(str(value["nonce"]))
        ciphertext = base64.b64decode(str(value["ciphertext"]))
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except Exception as exc:  # pragma: no cover - defensive branch
        raise ClinicalBundleStorageError("Unable to decrypt persisted handover bundle.") from exc

    try:
        payload = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:  # pragma: no cover - defensive branch
        raise ClinicalBundleStorageError("Persisted handover bundle is not valid JSON.") from exc

    if not isinstance(payload, dict):
        raise ClinicalBundleStorageError("Persisted handover bundle is not a JSON object.")
    return payload
