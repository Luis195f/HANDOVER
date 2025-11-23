import logging
import os
import uuid
from typing import Any, Dict, Optional

import httpx
from django.http import HttpRequest
from rest_framework.response import Response
from rest_framework.views import APIView
from fhir.resources.patient import Patient
from fhir.resources.medicationstatement import MedicationStatement
from fhir.resources.fhirabstractmodel import FHIRValidationError


FHIR_BASE = os.environ.get("FHIR_BASE", "http://localhost:8080/fhir")
FHIR_TOKEN = os.environ.get("FHIR_TOKEN", "")
HANDOVER_FHIR_VALIDATION_MODE = os.getenv("HANDOVER_FHIR_VALIDATION_MODE", "off")

logger = logging.getLogger(__name__)


def auth_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/fhir+json"}
    if FHIR_TOKEN:
        headers["Authorization"] = f"Bearer {FHIR_TOKEN}"
    return headers


def _validate_remotely(resource: Dict[str, Any], resource_type: str) -> Optional[Response]:
    if HANDOVER_FHIR_VALIDATION_MODE != "remote":
        return None

    validate_url = f"{FHIR_BASE.rstrip('/')}/{resource_type}/$validate"
    try:
        resp = httpx.post(validate_url, json=resource, headers=auth_headers(), timeout=30)
    except httpx.HTTPError as exc:
        logger.warning("Error al llamar a $validate para %s: %s", resource_type, exc)
        return None

    if resp.status_code in (404, 405):
        logger.warning("$validate no soportado para %s: %s", resource_type, resp.text)
        return None

    try:
        data = resp.json()
    except Exception:
        logger.warning("Respuesta de validación no es JSON para %s", resource_type)
        return None

    if not isinstance(data, dict) or data.get("resourceType") != "OperationOutcome":
        return None

    issues = data.get("issue") or []
    if not isinstance(issues, list):
        return None

    has_errors = any((issue.get("severity") in ("error", "fatal")) for issue in issues if isinstance(issue, dict))
    if has_errors:
        return Response(data, status=422)

    return None


def _post_to_fhir(resource: Dict[str, Any], resource_type: str) -> Response:
    resource = dict(resource)
    if not resource.get("id"):
        resource["id"] = str(uuid.uuid4())

    url = f"{FHIR_BASE.rstrip('/')}/{resource_type}"
    try:
        resp = httpx.post(url, json=resource, headers=auth_headers(), timeout=30)
    except httpx.HTTPError as exc:
        logger.error("Error al enviar %s al servidor FHIR: %s", resource_type, exc)
        return Response({"errors": ["No se pudo contactar al servidor FHIR."]}, status=502)

    if resp.status_code >= 400:
        return Response({"errors": [resp.text]}, status=resp.status_code)

    try:
        return Response(resp.json(), status=resp.status_code)
    except Exception:
        return Response({"errors": ["Respuesta del servidor FHIR no es JSON."]}, status=502)


class PatientView(APIView):
    def post(self, request: HttpRequest) -> Response:
        try:
            patient_obj = Patient.parse_obj(request.data)
        except FHIRValidationError as exc:
            return Response({"errors": [str(exc)]}, status=422)

        patient = patient_obj.dict(exclude_none=True)
        validation_response = _validate_remotely(patient, "Patient")
        if validation_response:
            return validation_response

        return _post_to_fhir(patient, "Patient")


class MedicationStatementView(APIView):
    def post(self, request: HttpRequest) -> Response:
        try:
            medication_statement_obj = MedicationStatement.parse_obj(request.data)
        except FHIRValidationError as exc:
            return Response({"errors": [str(exc)]}, status=422)

        medication_statement = medication_statement_obj.dict(exclude_none=True)
        validation_response = _validate_remotely(medication_statement, "MedicationStatement")
        if validation_response:
            return validation_response

        return _post_to_fhir(medication_statement, "MedicationStatement")
