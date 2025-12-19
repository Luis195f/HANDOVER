import copy
import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import django
import pytest
from django.core.management import call_command
from django.utils import timezone

sys.path.append(str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from backend.signature import (  # noqa: E402  pylint: disable=C0413
    SignatureSettings,
    SignatureVerificationError,
    record_signature_audit,
    sign_bundle,
    verify_bundle_signature,
)
from backend.api.models import HandoverSignatureAudit  # noqa: E402  pylint: disable=C0413


@pytest.fixture(scope="module", autouse=True)
def migrate_db(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        call_command("migrate", run_syncdb=True, verbosity=0)

def generate_ec_keypair(tmp_path):
    private_path = tmp_path / "private.pem"
    public_path = tmp_path / "public.pem"
    subprocess.run(
        ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(private_path)],
        check=True,
    )
    subprocess.run(
        ["openssl", "ec", "-in", str(private_path), "-pubout", "-out", str(public_path)],
        check=True,
    )
    return SignatureSettings(private_key_path=str(private_path), public_key_path=str(public_path), disabled=False)


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

    result = sign_bundle(bundle, user_id="nurse-1", settings=settings)
    assert result is not None
    bundle["signature"] = result.fhir_signature

    verification = verify_bundle_signature(bundle, settings=settings)
    assert verification is not None
    assert verification.bundle_hash == result.bundle_hash
    assert verification.signature_b64 == result.signature_b64


def test_signature_detects_tampering(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sign_bundle(bundle, user_id="nurse-2", settings=settings)
    bundle["signature"] = result.fhir_signature

    tampered = copy.deepcopy(bundle)
    tampered["entry"][0]["resource"]["id"] = "pat-2"

    with pytest.raises(SignatureVerificationError):
        verify_bundle_signature(tampered, settings=settings)


def test_audit_log_is_idempotent(tmp_path):
    settings = generate_ec_keypair(tmp_path)
    bundle = minimal_bundle()

    result = sign_bundle(bundle, user_id="nurse-3", settings=settings)
    bundle["signature"] = result.fhir_signature

    signature_time = timezone.now() - timedelta(minutes=5)
    HandoverSignatureAudit.objects.all().delete()
    record_signature_audit(
        user_id="nurse-3",
        bundle_hash=result.bundle_hash,
        signature_b64=result.signature_b64,
        signed_at=signature_time,
    )
    record_signature_audit(
        user_id="nurse-3",
        bundle_hash=result.bundle_hash,
        signature_b64=result.signature_b64,
        signed_at=signature_time + timedelta(minutes=1),
    )

    audits = list(HandoverSignatureAudit.objects.filter(bundle_hash=result.bundle_hash))
    assert len(audits) == 1
    assert audits[0].user_id == "nurse-3"
    assert audits[0].signature == result.signature_b64
