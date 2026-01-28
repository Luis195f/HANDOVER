import logging
import os
import uuid
from typing import Any, Dict, Optional, Tuple, Type

import httpx
from django.http import HttpRequest
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.security.auth import Auth0JWTAuthentication
from backend.security.permissions import NurseOrAdminPermission

logger = logging.getLogger(__name__)

# =========================
# FHIR resources imports (robustos)
# =========================

Bundle = None
Patient = None
MedicationStatement = None
FHIRValidationError = Exception  # fallback genérico

def _try_import_fhir_resources() -> Tuple[Any, Any, Any, Type[Exception]]:
    """
    Intenta importar clases FHIR desde:
      1) legacy: fhir.resources.<resource>
      2) versioned: fhir.resources.R4B.<resource>
      3) versioned: fhir.resources.R5.<resource>

    Devuelve: (Bundle, Patient, MedicationStatement, ValidationErrorClass)
    """
    # 1) Legacy
    try:
        from fhir.resources.bundle import Bundle as _Bundle  # type: ignore
        from fhir.resources.patient import Patient as _Patient  # type: ignore
        from fhir.resources.medicationstatement import MedicationStatement as _MedicationStatement  # type: ignore
        try:
            from fhir.resources.fhirabstractmodel import FHIRValidationError as _FHIRValidationError  # type: ignore
            _ValErr = _FHIRValidationError
        except Exception:
            # En algunas versiones la validación es pydantic_core.ValidationError
            try:
                from pydantic import ValidationError as _ValErr  # type: ignore
            except Exception:
                _ValErr = Exception

        return _Bundle, _Patient, _MedicationStatement, _ValErr
    except Exception:
        pass

    # 2) R4B
    try:
        from fhir.resources.R4B.bundle import Bundle as _Bundle  # type: ignore
        from fhir.resources.R4B.patient import Patient as _Patient  # type: ignore
        from fhir.resources.R4B.medicationstatement import MedicationStatement as _MedicationStatement  # type: ignore
        try:
            from fhir.resources.R4B.fhirabstractmodel import FHIRValidationError as _FHIRValidationError  # type: ignore
            _ValErr = _FHIRValidationError
        except Exception:
            try:
                from pydantic import ValidationError as _ValErr  # type: ignore
            except Exception:
                _ValErr = Exception

        return _Bundle, _Patient, _MedicationStatement, _ValErr
    except Exception:
        pass

    # 3) R5
    try:
        from fhir.resources.R5.bundle import Bundle as _Bundle  # type: ignore
        from fhir.resources.R5.patient import Patient as _Patient  # type: ignore
        from fhir.resources.R5.medicationstatement import MedicationStatement as _MedicationStatement  # type: ignore
        try:
            from fhir.resources.R5.fhirabstractmodel import FHIRValidationError as _FHIRValidationError  # type: ignore
            _ValErr = _FHIRValidationError
        except Exception:
            try:
                from pydantic import ValidationError as _ValErr  # type: ignore
            except Exception:
                _ValErr = Exception

        return _Bundle, _Patient, _MedicationStatement, _ValErr
    except Exception:
        pass

    raise ImportError("No se pudo importar fhir.resources (Bundle/Patient/MedicationStatement).")

try:
    Bundle, Patient, MedicationStatement, FHIRValidationError = _try_import_fhir_resources()
except ImportError as exc:  # pragma: no cover
    logger.warning("Dependencia fhir.resources no disponible: %s", exc)
    Bundle = Patient = MedicationStatement = None
    FHIRValidationError = Exception


# =========================
# Content negotiation: FHIR JSON (DRF)
# =========================

class FHIRJSONParser(JSONParser):
    """
    Permite recibir Content-Type: application/fhir+json
    """
    media_type = "application/fhir+json"


class FHIRJSONRenderer(JSONRenderer):
    """
    Permite responder con Accept: application/fhir+json
    """
    media_type = "application/fhir+json"
    format = "fhir+json"


# =========================
# Config
# =========================

FHIR_BASE = os.environ.get("FHIR_BASE", "http://localhost:8080/fhir")
FHIR_TOKEN = os.environ.get("FHIR_TOKEN", "")
HANDOVER_FHIR_VALIDATION_MODE = os.getenv("HANDOVER_FHIR_VALIDATION_MODE", "off").lower().strip()


def auth_headers() -> Dict[str, str]:
    """
    Headers para hablar con el servidor FHIR aguas abajo.
    """
    headers = {
        "Content-Type": "application/fhir+json",
        "Accept": "application/fhir+json",
    }
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
        logger.warning("Error al llamar a $validate para %s (%s): %s", resource_type, validate_url, exc)
        return Response({"errors": ["No se pudo contactar al servidor FHIR (validate)."]}, status=503)

    # Si el server no soporta $validate, seguimos sin bloquear
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

    has_errors = any(
        isinstance(issue, dict) and issue.get("severity") in ("error", "fatal")
        for issue in issues
    )
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
        logger.error("Error al enviar %s al servidor FHIR (%s): %s", resource_type, url, exc)
        return Response({"errors": ["No se pudo contactar al servidor FHIR."]}, status=503)

    if resp.status_code >= 400:
        return Response({"errors": [resp.text]}, status=resp.status_code)

    try:
        return Response(resp.json(), status=resp.status_code)
    except Exception:
        return Response({"errors": ["Respuesta del servidor FHIR no es JSON."]}, status=502)


# =========================
# Views
# =========================

class AuthenticatedAPIView(APIView):
    """
    Base para endpoints protegidos con JWT (Auth0).
    Además: soporta application/fhir+json (parser+renderer).
    """
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [IsAuthenticated, NurseOrAdminPermission]

    # ✅ Esto arregla 415 y 406 para FHIR JSON
    parser_classes = [FHIRJSONParser, JSONParser]
    renderer_classes = [FHIRJSONRenderer, JSONRenderer]


class PatientView(AuthenticatedAPIView):
    def post(self, request: HttpRequest) -> Response:
        if Patient is None:
            return Response({"errors": ["Dependencia fhir.resources no disponible."]}, status=500)

        try:
            patient_obj = Patient.parse_obj(request.data)
        except Exception as exc:
            # No dependemos de una clase exacta de error: pydantic / fhir.resources varía por versión
            return Response({"errors": [str(exc)]}, status=422)

        patient = patient_obj.dict(exclude_none=True)
        validation_response = _validate_remotely(patient, "Patient")
        if validation_response:
            return validation_response

        return _post_to_fhir(patient, "Patient")


class MedicationStatementView(AuthenticatedAPIView):
    def post(self, request: HttpRequest) -> Response:
        if MedicationStatement is None:
            return Response({"errors": ["Dependencia fhir.resources no disponible."]}, status=500)

        try:
            ms_obj = MedicationStatement.parse_obj(request.data)
        except Exception as exc:
            return Response({"errors": [str(exc)]}, status=422)

        medication_statement = ms_obj.dict(exclude_none=True)
        validation_response = _validate_remotely(medication_statement, "MedicationStatement")
        if validation_response:
            return validation_response

        return _post_to_fhir(medication_statement, "MedicationStatement")


class BundleView(AuthenticatedAPIView):
    def post(self, request: HttpRequest) -> Response:
        if Bundle is None:
            return Response({"errors": ["Dependencia fhir.resources no disponible."]}, status=500)

        try:
            bundle_obj = Bundle.parse_obj(request.data)
        except Exception as exc:
            return Response({"errors": [str(exc)]}, status=422)

        if getattr(bundle_obj, "type", None) != "transaction":
            return Response({"errors": ["Solo se permiten bundles de tipo transaction."]}, status=422)

        bundle = bundle_obj.dict(exclude_none=True)

        # Tag de tracking
        bundle_meta = bundle.get("meta") or {}
        tags = bundle_meta.get("tag") or []
        tags = tags if isinstance(tags, list) else []
        tags.append({"system": "urn:handover:tx", "code": str(uuid.uuid4())})
        bundle_meta["tag"] = tags
        bundle["meta"] = bundle_meta

        validation_response = _validate_remotely(bundle, "Bundle")
        if validation_response:
            return validation_response

        # POST transaction: se envía al "base endpoint" del servidor FHIR
        headers = auth_headers()
        headers["Prefer"] = "return=representation"

        fhir_tx_url = FHIR_BASE.rstrip("/")
        try:
            resp = httpx.post(fhir_tx_url, json=bundle, headers=headers, timeout=60)
        except httpx.HTTPError as exc:
            logger.error("No se pudo contactar FHIR server (tx) (%s): %s", fhir_tx_url, exc)
            return Response({"errors": ["No se pudo contactar al servidor FHIR."]}, status=503)

        if resp.status_code >= 400:
            return Response({"errors": [resp.text]}, status=resp.status_code)

        try:
            return Response(resp.json(), status=resp.status_code)
        except Exception:
            return Response({"errors": ["Respuesta del servidor FHIR no es JSON."]}, status=502)
