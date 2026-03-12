import copy
import json
import os
import shutil
import sys
from datetime import timedelta
from pathlib import Path

import django
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.db import OperationalError
from django.utils import timezone

# ---------------------------------------------------------------------
# Ensure repo root is on sys.path for direct execution
# ---------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# ---------------------------------------------------------------------
# Django setup (kept to avoid breaking standalone runs)
# In CI pytest-django usually provides this via --ds, but this is safe.
# ---------------------------------------------------------------------
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

import backend.signature as sig  # noqa: E402  pylint: disable=C0413

if not sig.CRYPTOGRAPHY_AVAILABLE:
    pytest.skip("cryptography no está disponible en el entorno de tests.", allow_module_level=True)

def generate_ec_keypair(tmp_path):
    private_path = tmp_path / "private.pem"
    public_path = tmp_path / "public.pem"

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    private_path.write_bytes(private_pem)
    public_path.write_bytes(public_pem)

    return sig.SignatureSettings(
        private_key_path=str(private_path),
        public_key_path=str(public_path),
        disabled=False,
    )


def minimal_bundle():
    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-1"},
            }
        ],
    }


def test_sign_and_verify_roundtrip(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-1", settings=settings)
    assert result is not None
    bundle["signature"] = result.fhir_signature

    verification = sig.verify_bundle_signature(bundle, settings=settings)
    assert verification is not None
    assert verification.bundle_hash == result.bundle_hash
    assert verification.signature_b64 == result.signature_b64


def test_signature_detects_tampering(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-2", settings=settings)
    bundle["signature"] = result.fhir_signature

    tampered = copy.deepcopy(bundle)
    tampered["entry"][0]["resource"]["id"] = "pat-2"

    with pytest.raises(sig.SignatureVerificationError) as exc_info:
        sig.verify_bundle_signature(tampered, settings=settings)

    error_text = str(exc_info.value)
    assert "pat-2" not in error_text
    assert "entry" not in error_text


@pytest.mark.django_db
def test_audit_log_is_idempotent(tmp_path):
    # Import INSIDE the DB test to keep non-DB tests clean.
    from backend.api.models import HandoverSignatureAudit  # noqa: E402

    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-3", settings=settings)
    bundle["signature"] = result.fhir_signature

    signature_time = timezone.now() - timedelta(minutes=5)
    try:
        HandoverSignatureAudit.objects.all().delete()
    except OperationalError as exc:
        if "no such table" in str(exc):
            pytest.skip("Tabla de auditoría no disponible en este entorno de pruebas")
        raise

    sig.record_signature_audit(
        user_id="nurse-3",
        bundle_hash=result.bundle_hash,
        signature_b64=result.signature_b64,
        signed_at=signature_time,
    )
    sig.record_signature_audit(
        user_id="nurse-3",
        bundle_hash=result.bundle_hash,
        signature_b64=result.signature_b64,
        signed_at=signature_time + timedelta(minutes=1),
    )

    audits = list(HandoverSignatureAudit.objects.filter(bundle_hash=result.bundle_hash))
    assert len(audits) == 1
    assert audits[0].user_id == "nurse-3"
    assert audits[0].signature == result.signature_b64


def test_canonicalization_is_stable():
    bundle_a = {
        "id": "bundle-1",
        "resourceType": "Bundle",
        "entry": [
            {
                "resource": {"id": "p1", "resourceType": "Patient"},
                "request": {"url": "Patient", "method": "POST"},
            }
        ],
        "type": "transaction",
    }
    bundle_b = {
        "type": "transaction",
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "p1"},
            }
        ],
        "resourceType": "Bundle",
        "id": "bundle-1",
    }

    canonical_a, digest_a, digest_hex_a = sig.canonical_bundle_payload(bundle_a)
    canonical_b, digest_b, digest_hex_b = sig.canonical_bundle_payload(bundle_b)

    assert canonical_a == canonical_b
    assert digest_a == digest_b
    assert digest_hex_a == digest_hex_b


def test_canonicalization_preserves_clinician_signature_lists():
    bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "signature": [
            {
                "type": [{"code": "signature"}],
                "when": "2026-03-10T11:00:00Z",
                "who": {"identifier": {"value": "nurse-1"}},
                "data": "clinician-signature-base64",
            }
        ],
        "entry": [
            {
                "request": {"method": "POST", "url": "Patient"},
                "resource": {"resourceType": "Patient", "id": "pat-1"},
            }
        ],
    }

    canonical_json, _, _ = sig.canonical_bundle_payload(bundle)

    assert "clinician-signature-base64" in canonical_json

def test_production_requires_cryptography(monkeypatch, tmp_path):
    settings = generate_ec_keypair(tmp_path)

    # Ensure we restore value after test, and we patch the module attribute itself.
    monkeypatch.setattr(sig, "CRYPTOGRAPHY_AVAILABLE", False)

    with pytest.raises(sig.SignatureOperationError, match="cryptography"):
        sig.validate_signature_runtime_requirements(settings)


def test_verification_reports_useful_errors_without_sensitive_data(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-4", settings=settings)
    assert result is not None

    bad_bundle = copy.deepcopy(bundle)
    bad_bundle["signature"] = {"data": "invalid-base64"}

    with pytest.raises(sig.SignatureVerificationError, match="base64 válido") as exc_info:
        sig.verify_bundle_signature(bad_bundle, settings=settings)

    error_text = str(exc_info.value)
    assert str(settings.private_key_path) not in error_text
    assert str(settings.public_key_path) not in error_text
    assert "pat-1" not in error_text
    assert json.dumps(bundle, ensure_ascii=False) not in error_text


def test_operation_error_does_not_expose_key_paths_or_payload(tmp_path):
    settings = sig.SignatureSettings(
        private_key_path=str(tmp_path / "does-not-exist-private.pem"),
        public_key_path=str(tmp_path / "does-not-exist-public.pem"),
        disabled=False,
    )
    bundle = minimal_bundle()

    with pytest.raises(sig.SignatureOperationError) as exc_info:
        sig.sign_bundle(bundle, user_id="nurse-err", settings=settings)

    error_text = str(exc_info.value)
    assert str(settings.private_key_path) not in error_text
    assert str(settings.public_key_path) not in error_text
    assert "pat-1" not in error_text
    assert json.dumps(bundle, ensure_ascii=False) not in error_text


def test_signature_audit_events_are_emitted_without_phi(monkeypatch, tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()
    events = []

    def _capture(**kwargs):
        events.append(kwargs)

    monkeypatch.setattr(sig, "_emit_signature_event", _capture)

    signed = sig.sign_bundle(bundle, user_id="nurse-5", settings=settings)
    assert signed is not None

    bundle["signature"] = signed.fhir_signature
    sig.verify_bundle_signature(bundle, settings=settings)

    assert len(events) >= 2
    for event in events:
        meta = event.get("meta", {})
        meta_dump = json.dumps(meta, ensure_ascii=False)

        assert "entry" not in meta_dump
        assert "Patient" not in meta_dump
        assert "resource" not in meta_dump
        assert json.dumps(bundle, ensure_ascii=False) not in meta_dump

        assert set(meta.keys()) == {"signature"}
        signature_meta = meta["signature"]
        assert set(signature_meta.keys()).issubset({"hash", "algorithm", "verified", "stored"})



def test_signature_sigformat_matches_algorithm(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-sigfmt", settings=settings)

    assert result is not None
    assert result.fhir_signature["sigFormat"] == "ecdsa-p256-sha256"


def test_openssl_fallback_roundtrip(tmp_path):
    if shutil.which("openssl") is None:
        pytest.skip("OpenSSL no está disponible en el entorno")

    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()
    canonical_json, _, _ = sig.canonical_bundle_payload(bundle)
    payload = canonical_json.encode("utf-8")

    signature_bytes = sig._sign_with_openssl(payload, settings.private_key_path)
    sig._verify_with_openssl(payload, signature_bytes, settings.public_key_path)

