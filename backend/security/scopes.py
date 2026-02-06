from __future__ import annotations

from typing import List, Dict

CLINICAL_SCOPES: List[str] = [
    "handover:read",
    "handover:write",
    "audit:read",
    "audit:write",
    "fhir:transaction",
    "patients:read",
    "patients:write",
]

FHIR_PROFILES: List[Dict[str, str]] = [
    {
        "canonical": "http://hl7.org/fhir/StructureDefinition/Bundle",
        "version": "4.0.1",
        "title": "FHIR R4 Bundle (transaction)",
    },
    {
        "canonical": "https://handover.health/fhir/StructureDefinition/HandoverBundle",
        "version": "0.1.0",
        "title": "Handover MVP Bundle (SBAR/turno)",
    },
]
