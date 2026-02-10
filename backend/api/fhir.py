# backend/api/fhir.py
from __future__ import annotations

from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer


class FHIRJSONParser(JSONParser):
    """
    Parser para aceptar FHIR JSON:
      Content-Type: application/fhir+json
    Reusa JSONParser estándar de DRF.
    """
    media_type = "application/fhir+json"


class FHIRJSONRenderer(JSONRenderer):
    """
    Renderer para responder FHIR JSON:
      Accept: application/fhir+json
    Reusa JSONRenderer estándar de DRF.
    """
    media_type = "application/fhir+json"
    format = "fhir+json"
