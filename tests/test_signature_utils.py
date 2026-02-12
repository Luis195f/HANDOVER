import copy
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

import django
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management import call_command
from django.utils import timezone

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

import backend.signature as sig  # noqa: E402  pylint: disable=C0413
from backend.api.models import HandoverSignatureAudit  # noqa: E402  pylint: disable=C0413



if not sig.CRYPTOGRAPHY_AVAILABLE:
    pytest.skip("cryptography no está disponible en el entorno de tests.", allow_module_level=True)


@pytest.fixture(scope="module", autouse=True)
def migrate_db():
    """Ejecuta migraciones automáticamente antes de las pruebas."""
    call_command("migrate", run_syncdb=True, verbosity=0)


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

    return sig.SignatureSettings(private_key_path=str(private_path), public_key_path=str(public_path), disabled=False)


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


def test_audit_log_is_idempotent(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sig.sign_bundle(bundle, user_id="nurse-3", settings=settings)
    bundle["signature"] = result.fhir_signature

    signature_time = timezone.now() - timedelta(minutes=5)
    HandoverSignatureAudit.objects.all().delete()
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
        "entry": [{"resource": {"id": "p1", "resourceType": "Patient"}, "request": {"url": "Patient", "method": "POST"}}],
        "type": "transaction",
    }
    bundle_b = {
        "type": "transaction",
        "entry": [{"request": {"method": "POST", "url": "Patient"}, "resource": {"resourceType": "Patient", "id": "p1"}}],
        "resourceType": "Bundle",
        "id": "bundle-1",
    }

    canonical_a, digest_a, digest_hex_a = sig.canonical_bundle_payload(bundle_a)
    canonical_b, digest_b, digest_hex_b = sig.canonical_bundle_payload(bundle_b)

    assert canonical_a == canonical_b
    assert digest_a == digest_b
    assert digest_hex_a == digest_hex_b


def test_production_requires_cryptography(monkeypatch, tmp_path):
    settings = generate_ec_keypair(tmp_path)
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
