import pytest
from fastapi import HTTPException

from backend.validation import validate_fhir_bundle


class _Resp:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text

    def json(self):
        return {"resourceType": "OperationOutcome", "issue": []}


class _Client:
    def __init__(self, response):
        self._response = response

    async def post(self, *args, **kwargs):
        return self._response


VALID_BUNDLE = {
    "resourceType": "Bundle",
    "type": "transaction",
    "entry": [{"resource": {"resourceType": "Patient"}}],
}


@pytest.mark.anyio("asyncio")
async def test_validate_fhir_bundle_404_permissive_by_default():
    client = _Client(_Resp(404, "not supported"))

    await validate_fhir_bundle(
        bundle=VALID_BUNDLE,
        client=client,
        base_url="http://localhost:8080/fhir",
        validation_mode="remote",
    )


@pytest.mark.anyio("asyncio")
async def test_validate_fhir_bundle_404_strict_raises_503():
    client = _Client(_Resp(405, "not supported"))

    with pytest.raises(HTTPException) as exc:
        await validate_fhir_bundle(
            bundle=VALID_BUNDLE,
            client=client,
            base_url="http://localhost:8080/fhir",
            validation_mode="remote",
            strict_validate=True,
        )

    assert exc.value.status_code == 503
    assert "HANDOVER_VALIDATE_STRICT" in exc.value.detail["errors"][0]
