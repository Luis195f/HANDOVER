import logging
import os
import uuid
from typing import Any, Dict, Optional, Tuple, Type

import httpx
from django.http import HttpRequest
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.audit.service import emit_audit_event
from backend.security.auth import Auth0JWTAuthentication
from backend.api.models import AuditEvent
from backend.security.permissions import ClinicianAuditPermission, NurseOrAdminPermission
from backend.security.permissions_roles import HasAnyRole
from backend.security.roles import extract_roles
from backend.security.scope_permissions import HasAnyScope, _extract_permissions_from_request, _get_claims_from_request


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
        from fhir.resources.medicationstatement import (  # type: ignore
            MedicationStatement as _MedicationStatement,
        )

        try:
            from fhir.resources.fhirabstractmodel import (  # type: ignore
                FHIRValidationError as _FHIRValidationError,
            )

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
        from fhir.resources.R4B.medicationstatement import (  # type: ignore
            MedicationStatement as _MedicationStatement,
        )

        try:
            from fhir.resources.R4B.fhirabstractmodel import (  # type: ignore
                FHIRValidationError as _FHIRValidationError,
            )

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
        from fhir.resources.R5.medicationstatement import (  # type: ignore
            MedicationStatement as _MedicationStatement,
        )

        try:
            from fhir.resources.R5.fhirabstractmodel import (  # type: ignore
                FHIRValidationError as _FHIRValidationError,
            )

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


def _get_bundle_identifier_value(bundle: Dict[str, Any]) -> str:
    identifier = bundle.get("identifier")
    if isinstance(identifier, dict):
        value = identifier.get("value")
        if value:
            return str(value)
    return ""


def _emit_bundle_audit(
    *,
    request: HttpRequest,
    payload_obj: Any,
    status: str,
    http_status: int,
    resource_id: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    emit_audit_event(
        event_type="fhir_transaction",
        action="create",
        status=status,
        http_status=http_status,
        request=request,
        resource_type="Bundle",
        resource_id=resource_id,
        payload_obj=payload_obj,
        meta=meta,
    )


# =========================
# Views
# =========================

class AuthenticatedAPIView(APIView):
    """
    Base para endpoints protegidos con JWT (Auth0).
    Además: soporta application/fhir+json (parser+renderer).
    """
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [IsAuthenticated, NurseOrAdminPermission, HasAnyScope.required("handover:write")]

    # ✅ Esto arregla 415 y 406 para FHIR JSON
    parser_classes = [FHIRJSONParser, JSONParser]
    renderer_classes = [FHIRJSONRenderer, JSONRenderer]

    def get_authenticators(self):
        # ✅ Evita explotar si hay None accidental en authentication_classes
        classes = [a for a in self.authentication_classes if a is not None]
        return [auth() for auth in classes]


class CapabilitiesView(APIView):
    authentication_classes = [Auth0JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: HttpRequest) -> Response:
        claims = _get_claims_from_request(request) or {}
        roles = sorted(extract_roles(claims))
        scopes = sorted(_extract_permissions_from_request(request))

        user_sub = ""
        if isinstance(claims, dict):
            user_sub = str(claims.get("sub") or "")
        if not user_sub:
            user = getattr(request, "user", None)
            user_sub = str(getattr(user, "sub", "") or getattr(user, "username", "") or "")

        permissions = {
            "canWriteHandover": "handover:write" in scopes,
            "canSignHandover": any(role in {"supervisor", "admin"} for role in roles),
            "canViewAudit": "handover:audit" in scopes,
            "canSendAuditEvents": "handover:write" in scopes,
            "isAdmin": "admin" in roles,
        }

        payload = {
            "userSub": user_sub,
            "roles": roles,
            "scopes": scopes,
            "permissions": permissions,
        }
        return Response(payload, status=200)

class PatientView(AuthenticatedAPIView):
    permission_classes = [
        IsAuthenticated,
        NurseOrAdminPermission,
        HasAnyScope.required("patients:write"),
    ]
    def post(self, request: HttpRequest) -> Response:
        if Patient is None:
            return Response({"errors": ["Dependencia fhir.resources no disponible."]}, status=500)

        try:
            patient_obj = Patient.parse_obj(request.data)
        except Exception as exc:
            return Response({"errors": [str(exc)]}, status=422)

        patient = patient_obj.dict(exclude_none=True)
        validation_response = _validate_remotely(patient, "Patient")
        if validation_response:
            return validation_response

        return _post_to_fhir(patient, "Patient")


class MedicationStatementView(AuthenticatedAPIView):
    permission_classes = [IsAuthenticated, HasAnyScope.required("patients:write")]
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
    permission_classes = [
        IsAuthenticated,
        HasAnyRole.required("nurse", "supervisor", "admin"),
        HasAnyScope.required("handover:write"),
    ]
    def post(self, request: HttpRequest) -> Response:
        if Bundle is None:
            return Response({"errors": ["Dependencia fhir.resources no disponible."]}, status=500)

        payload_obj = request.data
        try:
            bundle_obj = Bundle.parse_obj(request.data)
        except Exception as exc:
            _emit_bundle_audit(
                request=request,
                payload_obj=payload_obj,
                status="fail",
                http_status=422,
                resource_id=getattr(request, "audit_request_id", ""),
                meta={"errorCode": "FHIR_VALIDATION_ERROR"},
            )
            return Response({"errors": [str(exc)]}, status=422)

        if getattr(bundle_obj, "type", None) != "transaction":
            _emit_bundle_audit(
                request=request,
                payload_obj=payload_obj,
                status="fail",
                http_status=422,
                resource_id=getattr(request, "audit_request_id", ""),
                meta={"errorCode": "FHIR_VALIDATION_ERROR"},
            )
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
            _emit_bundle_audit(
                request=request,
                payload_obj=bundle,
                status="fail",
                http_status=validation_response.status_code,
                resource_id=_get_bundle_identifier_value(bundle) or getattr(request, "audit_request_id", ""),
                meta={"errorCode": "FHIR_VALIDATION_ERROR"},
            )
            return validation_response

        # POST transaction: se envía al "base endpoint" del servidor FHIR
        headers = auth_headers()
        headers["Prefer"] = "return=representation"

        fhir_tx_url = FHIR_BASE.rstrip("/")
        try:
            resp = httpx.post(fhir_tx_url, json=bundle, headers=headers, timeout=60)
        except httpx.HTTPError as exc:
            logger.error("No se pudo contactar FHIR server (tx) (%s): %s", fhir_tx_url, exc)
            _emit_bundle_audit(
                request=request,
                payload_obj=bundle,
                status="fail",
                http_status=503,
                resource_id=_get_bundle_identifier_value(bundle) or getattr(request, "audit_request_id", ""),
                meta={"errorCode": "FHIR_VALIDATION_ERROR"},
            )
            return Response({"errors": ["No se pudo contactar al servidor FHIR."]}, status=503)

        if resp.status_code >= 400:
            meta = None
            if resp.status_code == 422 or resp.status_code >= 500:
                meta = {"errorCode": "FHIR_VALIDATION_ERROR"}
            _emit_bundle_audit(
                request=request,
                payload_obj=bundle,
                status="fail",
                http_status=resp.status_code,
                resource_id=_get_bundle_identifier_value(bundle) or getattr(request, "audit_request_id", ""),
                meta=meta,
            )
            return Response({"errors": [resp.text]}, status=resp.status_code)

        try:
            payload = resp.json()
        except Exception:
            _emit_bundle_audit(
                request=request,
                payload_obj=bundle,
                status="fail",
                http_status=502,
                resource_id=_get_bundle_identifier_value(bundle) or getattr(request, "audit_request_id", ""),
                meta={"errorCode": "FHIR_VALIDATION_ERROR"},
            )
            return Response({"errors": ["Respuesta del servidor FHIR no es JSON."]}, status=502)

        _emit_bundle_audit(
            request=request,
            payload_obj=bundle,
            status="success",
            http_status=resp.status_code,
            resource_id=_get_bundle_identifier_value(bundle) or getattr(request, "audit_request_id", ""),
        )
        return Response(payload, status=resp.status_code)


class AuditLogView(AuthenticatedAPIView):
    # OJO: sobrescribe el permiso base (NurseOrAdminPermission) por el de auditoría
    permission_classes = [
        IsAuthenticated,
        ClinicianAuditPermission,
        HasAnyScope.required("handover:audit"),
    ]
    allowed_types = {"patient_open", "patient_edit"}

    def get(self, request: HttpRequest) -> Response:
        try:
            limit = int(request.query_params.get("limit", "200"))
        except (TypeError, ValueError):
            limit = 200
        limit = max(10, min(limit, 500))

        logs = AuditEvent.objects.all()[:limit]
        payload = [self._serialize_event(event) for event in logs]
        return Response(payload, status=200)

    def post(self, request: HttpRequest) -> Response:
        data = request.data if isinstance(request.data, dict) else {}
        event_type = data.get("type")
        if event_type not in self.allowed_types:
            return Response({"errors": ["Tipo de auditoría inválido."]}, status=400)

        user_id = data.get("userId")
        if not user_id:
            return Response({"errors": ["userId es requerido."]}, status=400)

        raw_at = data.get("at")
        occurred_at = parse_datetime(raw_at) if isinstance(raw_at, str) else None
        if occurred_at is None:
            occurred_at = timezone.now()
        if timezone.is_naive(occurred_at):
            occurred_at = timezone.make_aware(occurred_at, timezone.get_current_timezone())

        event = AuditEvent.objects.create(
            type=str(event_type),
            user_id=str(user_id),
            patient_id=str(data.get("patientId") or ""),
            unit_id=str(data.get("unitId") or ""),
            shift_code=str(data.get("shiftCode") or ""),
            meta=data.get("meta") if isinstance(data.get("meta"), dict) else None,
            occurred_at=occurred_at,
        )

        return Response(self._serialize_event(event), status=201)

    @staticmethod
    def _serialize_event(event: AuditEvent) -> Dict[str, Any]:
        return {
            "id": event.id,
            "type": event.type,
            "userId": event.user_id,
            "patientId": event.patient_id or None,
            "unitId": event.unit_id or None,
            "shiftCode": event.shift_code or None,
            "at": event.occurred_at.isoformat(),
        }
