"""Deprecated legacy validation helpers.

This module is kept for backward compatibility in tests and old integrations.
Runtime request validation lives in ``backend.api.views._validate_remotely``.
"""

from typing import Any, Dict, List
import logging

import httpx
from rest_framework.exceptions import APIException, ValidationError

logger = logging.getLogger(__name__)


class RemoteValidationUnavailable(APIException):
    status_code = 503
    default_detail = {
        "errors": [
            "El servidor FHIR no soporta $validate y HANDOVER_VALIDATE_STRICT está habilitado."
        ]
    }
    default_code = "service_unavailable"


async def validate_fhir_bundle(
    bundle: Dict[str, Any],
    client: httpx.AsyncClient,
    base_url: str,
    validation_mode: str,
    strict_validate: bool = False,
) -> None:
    """
    Valida un Bundle FHIR usando la operación $validate del servidor FHIR remoto.

    - Si validation_mode == "off", no hace nada.
    - Si validation_mode == "remote", llama a POST {base_url}/Bundle/$validate.
    - Si el servidor devuelve OperationOutcome con `issue.severity` error/fatal,
      lanza ValidationError(422) con detalles resumidos.
    - Si el servidor no soporta $validate (404/405), registra warning y considera
      la validación como pasada, salvo strict_validate=True (falla cerrado).
    """
    if validation_mode == "off":
        return

    if not isinstance(bundle, dict) or bundle.get("resourceType") != "Bundle":
        raise ValidationError(
            {"errors": ["Payload no es un Bundle FHIR válido (resourceType != 'Bundle')."]}
        )

    entries = bundle.get("entry")
    if entries is None or not isinstance(entries, list):
        raise ValidationError({"errors": ["El Bundle FHIR debe incluir 'entry' como lista."]})

    validate_url = base_url.rstrip("/") + "/Bundle/$validate"

    try:
        response = await client.post(validate_url, json=bundle)
    except httpx.HTTPError as exc:
        logger.warning("Error al llamar a $validate en el servidor FHIR: %s", exc)
        return

    if response.status_code in (404, 405):
        logger.warning(
            "$validate no soportado por el servidor FHIR (%s): %s",
            response.status_code,
            response.text,
        )
        if strict_validate:
            raise RemoteValidationUnavailable()
        return

    if not (200 <= response.status_code < 300):
        logger.warning(
            "Respuesta no exitosa de $validate (status %s): %s",
            response.status_code,
            response.text,
        )
        return

    data = response.json()
    if not isinstance(data, dict):
        return

    if data.get("resourceType") != "OperationOutcome":
        return

    issues = data.get("issue") or []
    if not isinstance(issues, list):
        return

    error_messages: List[str] = []
    for issue in issues:
        severity = issue.get("severity")
        if severity not in ("error", "fatal"):
            continue
        details_text = ""
        if isinstance(issue.get("details"), dict):
            details_text = issue["details"].get("text") or ""
        diagnostics = issue.get("diagnostics") or ""
        msg_parts = [part for part in [details_text, diagnostics] if part]
        msg = " - ".join(msg_parts) or "Error de validación FHIR sin detalle."
        error_messages.append(msg)

    if error_messages:
        raise ValidationError({"errors": error_messages, "operationOutcome": data})
