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

class SignatureVerificationError(Exception):
    """Raised when a bundle signature cannot be validated."""


class SignatureOperationError(RuntimeError):
    """Raised when signing or verification cannot be executed safely."""

logger = logging.getLogger(__name__)


def _emit_signature_event(**kwargs: Any) -> None:
    try:
        from backend.audit.service import emit_audit_event
    except Exception:
        logger.debug("No se pudo cargar backend.audit.service para evento de firma.")
        return
    emit_audit_event(**kwargs)


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


def validate_signature_runtime_requirements(settings: Optional[SignatureSettings] = None) -> None:
    """Ensure runtime requirements are met for enabled signatures."""
    selected = settings or load_settings()
    if not selected.enabled:
        return
    if not CRYPTOGRAPHY_AVAILABLE:
        raise SignatureOperationError(
            "La firma digital está habilitada, pero falta la dependencia obligatoria `cryptography`."
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
        raise SignatureOperationError("La librería cryptography no está disponible.")
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise SignatureOperationError("No se pudo leer la clave privada configurada.") from exc
    try:
        return serialization.load_pem_private_key(data, password=None)
    except Exception as exc:  # pragma: no cover - depende del backend criptográfico
        raise SignatureOperationError("No se pudo cargar la clave privada PEM para firma.") from exc


@lru_cache(maxsize=1)
def _load_public_key(path: str):
    if not CRYPTOGRAPHY_AVAILABLE:  # pragma: no cover - evitado en entornos sin cryptography
        raise SignatureOperationError("La librería cryptography no está disponible.")
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        raise SignatureOperationError("No se pudo leer la clave pública configurada.") from exc
    try:
        return serialization.load_pem_public_key(data)
    except Exception as exc:  # pragma: no cover - depende del backend criptográfico
        raise SignatureOperationError("No se pudo cargar la clave pública PEM para verificación.") from exc


def _sign_with_openssl(payload: bytes, private_key_path: str) -> bytes:
    try:
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", private_key_path],
            input=payload,
            capture_output=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise SignatureOperationError("OpenSSL no está disponible para firmar bundles.") from exc
    except subprocess.CalledProcessError as exc:
        raise SignatureOperationError("OpenSSL falló al firmar el bundle; revise el formato de la clave privada.") from exc
    return result.stdout


def _verify_with_openssl(payload: bytes, signature: bytes, public_key_path: str) -> None:
    with tempfile.NamedTemporaryFile() as sig_file:
        sig_file.write(signature)
        sig_file.flush()
        try:
            subprocess.run(
                ["openssl", "dgst", "-sha256", "-verify", public_key_path, "-signature", sig_file.name],
                input=payload,
                capture_output=True,
                check=True,
            )
        except FileNotFoundError as exc:
            raise SignatureOperationError("OpenSSL no está disponible para verificar firmas.") from exc
        except subprocess.CalledProcessError as exc:
            raise SignatureVerificationError("La firma no coincide con el contenido canónico del bundle.") from exc


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
        "sigFormat": "ecdsa-p256-sha256",
        "data": signature_b64,
    }


@dataclass
class SignatureResult:
    fhir_signature: Dict[str, Any]
    bundle_hash: str
    signature_b64: str


def sign_bundle(bundle: Dict[str, Any], *, user_id: Optional[str], settings: Optional[SignatureSettings] = None) -> Optional[SignatureResult]:
    settings = settings or load_settings()
    validate_signature_runtime_requirements(settings)
    if not settings.enabled:
        logger.info("Firma de Bundle omitida: configuración deshabilitada o incompleta.")
        return None

    canonical_json, digest, digest_hex = canonical_bundle_payload(bundle)
    canonical_payload = canonical_json.encode("utf-8")
    try:
        if CRYPTOGRAPHY_AVAILABLE:
            private_key = _load_private_key(settings.private_key_path)  # type: ignore[arg-type]
            signature_bytes = private_key.sign(canonical_payload, ec.ECDSA(hashes.SHA256()))
        else:
            signature_bytes = _sign_with_openssl(canonical_payload, settings.private_key_path)  # type: ignore[arg-type]
    except Exception as exc:
        logger.error("No se pudo firmar el bundle %s", digest_hex)
        raise SignatureOperationError("No se pudo firmar el bundle; valide configuración de claves y dependencias.") from exc

    signature_b64 = base64.b64encode(signature_bytes).decode("ascii")
    fhir_signature = _build_fhir_signature(user_id=user_id, signature_b64=signature_b64)
    logger.debug("Bundle firmado con hash %s", digest_hex)
    _emit_signature_event(
        event_type="handover.signature",
        action="create",
        status="success",
        user_sub=user_id,
        resource_type="Bundle",
        resource_id=bundle.get("id", ""),
        payload_hash=digest_hex,
        meta={"signature": {"algorithm": "ECDSA-SHA256", "hash": digest_hex}},
    )
    return SignatureResult(fhir_signature=fhir_signature, bundle_hash=digest_hex, signature_b64=signature_b64)


@dataclass
class VerificationResult:
    bundle_hash: str
    signature_b64: str


def verify_bundle_signature(bundle: Dict[str, Any], settings: Optional[SignatureSettings] = None) -> Optional[VerificationResult]:
    settings = settings or load_settings()
    validate_signature_runtime_requirements(settings)
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
    canonical_payload = canonical_json.encode("utf-8")
    try:
        signature_bytes = base64.b64decode(signature_b64)
    except (ValueError, TypeError) as exc:
        raise SignatureVerificationError("El campo signature.data no es base64 válido.") from exc
    try:
        if CRYPTOGRAPHY_AVAILABLE:
            public_key = _load_public_key(settings.public_key_path)  # type: ignore[arg-type]
            public_key.verify(signature_bytes, canonical_payload, ec.ECDSA(hashes.SHA256()))
        else:
            _verify_with_openssl(canonical_payload, signature_bytes, settings.public_key_path)  # type: ignore[arg-type]
    except CryptoInvalidSignature as exc:
        logger.error("La verificación de firma falló para bundle %s", digest_hex)
        raise SignatureVerificationError("La firma no coincide con el contenido canónico del bundle.") from exc
    except SignatureVerificationError:
        logger.error("La verificación de firma falló para bundle %s", digest_hex)
        raise
    except Exception as exc:
        logger.error("Error técnico verificando firma del bundle %s", digest_hex)
        raise SignatureOperationError("No se pudo verificar la firma del bundle por un error técnico.") from exc

    logger.info("Firma FHIR verificada correctamente para bundle %s", digest_hex)
    _emit_signature_event(
        event_type="handover.signature",
        action="read",
        status="success",
        resource_type="Bundle",
        resource_id=bundle.get("id", ""),
        payload_hash=digest_hex,
        meta={"signature": {"verified": True, "hash": digest_hex}},
    )
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
    else:
        _emit_signature_event(
            event_type="handover.signature.audit",
            action="create",
            status="success",
            user_sub=user_id,
            resource_type="Bundle",
            payload_hash=bundle_hash,
            meta={"signature": {"stored": True, "hash": bundle_hash}},
            timestamp=signed_at_value,
        )
