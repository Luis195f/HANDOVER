import base64
import hashlib
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, Optional

from django.db import IntegrityError
from django.utils import timezone as django_timezone

try:  # pragma: no cover - dependencia opcional en entornos sin acceso a pip
    from cryptography.exceptions import InvalidSignature as CryptoInvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    CRYPTOGRAPHY_AVAILABLE = True
except ImportError:  # pragma: no cover - fallback cuando cryptography no está instalado
    class CryptoInvalidSignature(Exception):
        pass

    hashes = serialization = ec = None  # type: ignore[assignment]
    CRYPTOGRAPHY_AVAILABLE = False

SignatureVerificationError = CryptoInvalidSignature

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SignatureSettings:
    private_key_path: Optional[str]
    public_key_path: Optional[str]
    disabled: bool

    @property
    def enabled(self) -> bool:
        return bool(not self.disabled and self.private_key_path and self.public_key_path)


def load_settings() -> SignatureSettings:
    disabled_env = os.getenv("HANDOVER_SIGNATURE_DISABLED", "false").lower() in {"1", "true", "yes"}
    return SignatureSettings(
        private_key_path=os.getenv("HANDOVER_PRIVATE_KEY_PATH"),
        public_key_path=os.getenv("HANDOVER_PUBLIC_KEY_PATH"),
        disabled=disabled_env,
    )


def _deep_copy_without_signature(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep copy of bundle without the `signature` field."""
    try:
        clone = json.loads(json.dumps(bundle))
    except (TypeError, ValueError) as exc:  # pragma: no cover - defensive guard
        raise ValueError("El Bundle FHIR no se pudo serializar para firmar.") from exc
    clone.pop("signature", None)
    return clone


def canonical_bundle_payload(bundle: Dict[str, Any]) -> tuple[str, bytes, str]:
    """
    Build the canonical JSON representation of a Bundle and its SHA-256 digest.

    Returns (canonical_json, digest_bytes, digest_hex)
    """
    unsigned = _deep_copy_without_signature(bundle)
    canonical_json = json.dumps(unsigned, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(canonical_json.encode("utf-8")).digest()
    return canonical_json, digest, digest.hex()


@lru_cache(maxsize=1)
def _load_private_key(path: str):
    if not CRYPTOGRAPHY_AVAILABLE:  # pragma: no cover - evitado en entornos sin cryptography
        raise RuntimeError("La librería cryptography no está disponible.")
    with open(path, "rb") as fh:
        data = fh.read()
    return serialization.load_pem_private_key(data, password=None)


@lru_cache(maxsize=1)
def _load_public_key(path: str):
    if not CRYPTOGRAPHY_AVAILABLE:  # pragma: no cover - evitado en entornos sin cryptography
        raise RuntimeError("La librería cryptography no está disponible.")
    with open(path, "rb") as fh:
        data = fh.read()
    return serialization.load_pem_public_key(data)


def _sign_with_openssl(payload: bytes, private_key_path: str) -> bytes:
    result = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", private_key_path],
        input=payload,
        capture_output=True,
        check=True,
    )
    return result.stdout


def _verify_with_openssl(payload: bytes, signature: bytes, public_key_path: str) -> None:
    with tempfile.NamedTemporaryFile() as sig_file:
        sig_file.write(signature)
        sig_file.flush()
        subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", public_key_path, "-signature", sig_file.name],
            input=payload,
            capture_output=True,
            check=True,
        )


def _build_fhir_signature(user_id: Optional[str], signature_b64: str) -> Dict[str, Any]:
    return {
        "type": [
            {
                "system": "urn:iso-astm:E1762-95:2013",
                "code": "1.2.840.10065.1.12.1.1",
                "display": "Author's Signature",
            }
        ],
        "when": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "who": {"identifier": {"value": user_id or "unknown"}},
        "sigFormat": "application/pkcs7-signature",
        "data": signature_b64,
    }


@dataclass
class SignatureResult:
    fhir_signature: Dict[str, Any]
    bundle_hash: str
    signature_b64: str


def sign_bundle(bundle: Dict[str, Any], *, user_id: Optional[str], settings: Optional[SignatureSettings] = None) -> Optional[SignatureResult]:
    settings = settings or load_settings()
    if not settings.enabled:
        logger.info("Firma de Bundle omitida: configuración deshabilitada o incompleta.")
        return None

    canonical_json, digest, digest_hex = canonical_bundle_payload(bundle)
    try:
        if CRYPTOGRAPHY_AVAILABLE:
            private_key = _load_private_key(settings.private_key_path)  # type: ignore[arg-type]
            signature_bytes = private_key.sign(digest, ec.ECDSA(hashes.SHA256()))
        else:
            signature_bytes = _sign_with_openssl(canonical_json.encode("utf-8"), settings.private_key_path)  # type: ignore[arg-type]
    except Exception as exc:
        logger.error("No se pudo firmar el bundle: %s", exc)
        raise

    signature_b64 = base64.b64encode(signature_bytes).decode("ascii")
    fhir_signature = _build_fhir_signature(user_id=user_id, signature_b64=signature_b64)
    logger.debug("Bundle firmado con hash %s", digest_hex)
    return SignatureResult(fhir_signature=fhir_signature, bundle_hash=digest_hex, signature_b64=signature_b64)


@dataclass
class VerificationResult:
    bundle_hash: str
    signature_b64: str


def verify_bundle_signature(bundle: Dict[str, Any], settings: Optional[SignatureSettings] = None) -> Optional[VerificationResult]:
    settings = settings or load_settings()
    signature_node = bundle.get("signature")
    if not signature_node:
        return None
    if not settings.enabled:
        logger.warning("Se recibió un bundle con firma pero la verificación está deshabilitada.")
        return None

    signature_b64 = signature_node.get("data") if isinstance(signature_node, dict) else None
    if not signature_b64:
        raise ValueError("El campo signature.data es obligatorio para verificar la firma.")

    canonical_json, digest, digest_hex = canonical_bundle_payload(bundle)
    signature_bytes = base64.b64decode(signature_b64)
    try:
        if CRYPTOGRAPHY_AVAILABLE:
            public_key = _load_public_key(settings.public_key_path)  # type: ignore[arg-type]
            public_key.verify(signature_bytes, digest, ec.ECDSA(hashes.SHA256()))
        else:
            _verify_with_openssl(canonical_json.encode("utf-8"), signature_bytes, settings.public_key_path)  # type: ignore[arg-type]
    except subprocess.CalledProcessError as exc:
        logger.error("La verificación de firma falló para bundle %s", digest_hex)
        raise SignatureVerificationError() from exc
    except SignatureVerificationError as exc:
        logger.error("La verificación de firma falló para bundle %s", digest_hex)
        raise exc

    logger.info("Firma FHIR verificada correctamente para bundle %s", digest_hex)
    return VerificationResult(bundle_hash=digest_hex, signature_b64=signature_b64)


def record_signature_audit(
    *, user_id: Optional[str], bundle_hash: str, signature_b64: str, signed_at: Optional[datetime] = None
) -> None:
    try:
        from backend.api.models import HandoverSignatureAudit
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.warning("No se pudo importar el modelo de auditoría de firma: %s", exc)
        return

    signed_at_value = signed_at or django_timezone.now()
    try:
        HandoverSignatureAudit.objects.get_or_create(
            bundle_hash=bundle_hash,
            defaults={
                "user_id": user_id or "",
                "signature": signature_b64,
                "signed_at": signed_at_value,
            },
        )
    except IntegrityError:
        logger.info("Ya existe un registro de firma para el bundle %s", bundle_hash)
    except Exception as exc:  # pragma: no cover - safeguard against DB errors
        logger.warning("No se pudo registrar la auditoría de firma: %s", exc)
