import hashlib
import json
import logging
import os
from typing import Any

from django.http import HttpRequest
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


logger = logging.getLogger(__name__)

CATALOG_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"
NANDA_LICENSE_WARNING = "Licencia NANDA-I requerida"
NIC_LICENSE_WARNING = "Licencia NIC requerida"
NOC_LICENSE_WARNING = "Licencia NOC requerida"

NANDA_PLACEHOLDER_CODES: list[dict[str, Any]] = [
    {
        "system": "NANDA",
        "code": "00001",
        "display": "Oxigenación alterada",
        "synonyms": ["oxigenación alterada", "oxygenation altered"],
    },
    {
        "system": "NANDA",
        "code": "00004",
        "display": "Riesgo de infección",
        "synonyms": ["riesgo de infección", "infection risk"],
    },
    {
        "system": "NANDA",
        "code": "00146",
        "display": "Ansiedad",
        "synonyms": ["ansiedad", "anxiety"],
    },
    {
        "system": "NANDA",
        "code": "00155",
        "display": "Dolor agudo",
        "synonyms": ["dolor agudo", "acute pain"],
    },
]

NIC_PLACEHOLDER_CODES: list[dict[str, Any]] = [
    {
        "system": "NIC",
        "code": "2210",
        "display": "Administración de analgésicos",
        "synonyms": ["manejo analgésico", "control del dolor"],
    },
    {
        "system": "NIC",
        "code": "3350",
        "display": "Monitorización respiratoria",
        "synonyms": ["vigilancia respiratoria", "seguimiento respiratorio"],
    },
    {
        "system": "NIC",
        "code": "6680",
        "display": "Monitorización de signos vitales",
        "synonyms": ["vigilancia de signos vitales", "signos vitales"],
    },
    {
        "system": "NIC",
        "code": "5602",
        "display": "Enseñanza: proceso de enfermedad",
        "synonyms": ["educación al paciente", "proceso de enfermedad"],
    },
]

NOC_PLACEHOLDER_CODES: list[dict[str, Any]] = [
    {
        "system": "NOC",
        "code": "0402",
        "display": "Estado respiratorio: permeabilidad de las vías aéreas",
        "synonyms": ["permeabilidad de vias aereas", "estado respiratorio"],
    },
    {
        "system": "NOC",
        "code": "0802",
        "display": "Signos vitales",
        "synonyms": ["constantes vitales", "monitorización de signos vitales"],
    },
    {
        "system": "NOC",
        "code": "1605",
        "display": "Control del dolor",
        "synonyms": ["manejo del dolor", "dolor controlado"],
    },
    {
        "system": "NOC",
        "code": "1813",
        "display": "Conocimiento: régimen terapéutico",
        "synonyms": ["educación terapéutica", "régimen terapéutico"],
    },
]

GOVERNED_CATALOG_CONFIG: dict[str, dict[str, Any]] = {
    "NANDA": {
        "inline_env": "NANDA_CATALOG_JSON",
        "file_env": "NANDA_CATALOG_FILE",
        "warning": NANDA_LICENSE_WARNING,
        "placeholder_codes": NANDA_PLACEHOLDER_CODES,
        "placeholder_version": "placeholder-2026-03",
    },
    "NIC": {
        "inline_env": "NIC_CATALOG_JSON",
        "file_env": "NIC_CATALOG_FILE",
        "warning": NIC_LICENSE_WARNING,
        "placeholder_codes": NIC_PLACEHOLDER_CODES,
        "placeholder_version": "placeholder-2026-03",
    },
    "NOC": {
        "inline_env": "NOC_CATALOG_JSON",
        "file_env": "NOC_CATALOG_FILE",
        "warning": NOC_LICENSE_WARNING,
        "placeholder_codes": NOC_PLACEHOLDER_CODES,
        "placeholder_version": "placeholder-2026-03",
    },
}


def normalize_governed_catalog_entry(value: Any, system_name: str) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    code = str(value.get("code") or "").strip()
    display = str(value.get("display") or "").strip()
    if not code or not display:
        return None

    system = str(value.get("system") or system_name).strip().upper()
    if system != system_name:
        return None

    raw_synonyms = value.get("synonyms")
    synonyms = (
        [str(item).strip() for item in raw_synonyms if isinstance(item, str) and str(item).strip()]
        if isinstance(raw_synonyms, list)
        else []
    )

    payload = {
        "system": system_name,
        "code": code,
        "display": display,
    }
    if synonyms:
        payload["synonyms"] = synonyms
    return payload


def build_governed_catalog_payload(system_name: str) -> dict[str, Any]:
    config = GOVERNED_CATALOG_CONFIG[system_name]
    inline_catalog_json = os.getenv(config["inline_env"], "").strip()
    catalog_file = os.getenv(config["file_env"], "").strip()

    raw_payload: Any = None
    source = "placeholder"
    licensed = False

    if inline_catalog_json:
        source = "env-json"
        licensed = True
        try:
            raw_payload = json.loads(inline_catalog_json)
        except Exception:
            logger.exception("Invalid %s configuration", config["inline_env"])
            raw_payload = None
            source = "placeholder"
            licensed = False
    elif catalog_file:
        source = "file"
        licensed = True
        try:
            with open(catalog_file, "r", encoding="utf-8") as catalog_handle:
                raw_payload = json.load(catalog_handle)
        except Exception:
            logger.exception("Unable to load %s catalog from %s", system_name, catalog_file)
            raw_payload = None
            source = "placeholder"
            licensed = False

    payload_record = raw_payload if isinstance(raw_payload, dict) else None
    if isinstance(raw_payload, list):
        raw_codes = raw_payload
    elif isinstance(payload_record, dict) and isinstance(payload_record.get("codes"), list):
        raw_codes = payload_record.get("codes") or []
    elif isinstance(payload_record, dict) and isinstance(payload_record.get("entries"), list):
        raw_codes = payload_record.get("entries") or []
    else:
        raw_codes = []

    codes = [
        entry
        for entry in (normalize_governed_catalog_entry(item, system_name) for item in raw_codes)
        if entry is not None
    ]

    if isinstance(payload_record, dict) and isinstance(payload_record.get("licensed"), bool):
        licensed = payload_record["licensed"]

    warning = (
        str(payload_record.get("warning")).strip()
        if isinstance(payload_record, dict) and payload_record.get("warning")
        else config["warning"]
    )
    version = (
        str(payload_record.get("version")).strip()
        if isinstance(payload_record, dict) and payload_record.get("version")
        else "licensed-runtime" if licensed else config["placeholder_version"]
    )

    if not codes:
        codes = [dict(item) for item in config["placeholder_codes"]]
        licensed = False
        source = "placeholder"
        version = config["placeholder_version"]

    return {
        "system": system_name,
        "licensed": licensed,
        "source": source,
        "version": version,
        "warning": warning,
        "codes": codes,
    }


def build_governed_catalog_etag(payload: dict[str, Any]) -> str:
    payload_bytes = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f'W/"{hashlib.sha256(payload_bytes).hexdigest()}"'


def build_nanda_catalog_payload() -> dict[str, Any]:
    return build_governed_catalog_payload("NANDA")


def build_nanda_catalog_etag(payload: dict[str, Any]) -> str:
    return build_governed_catalog_etag(payload)


class GovernedCatalogView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    system_name = ""

    def get(self, request: HttpRequest) -> Response:
        payload = build_governed_catalog_payload(self.system_name)
        etag = build_governed_catalog_etag(payload)
        request_etag = request.headers.get("If-None-Match") or request.META.get("HTTP_IF_NONE_MATCH")

        if request_etag == etag:
            response = Response(status=304)
        else:
            response = Response(payload, status=200)

        response["ETag"] = etag
        response["Cache-Control"] = CATALOG_CACHE_CONTROL
        return response


class NandaCatalogView(GovernedCatalogView):
    system_name = "NANDA"


class NicCatalogView(GovernedCatalogView):
    system_name = "NIC"


class NocCatalogView(GovernedCatalogView):
    system_name = "NOC"
