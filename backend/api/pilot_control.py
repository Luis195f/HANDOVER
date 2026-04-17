from __future__ import annotations

import json
import os
from typing import Any

from django.conf import settings
from django.utils import timezone

from backend.security.roles import extract_roles

PILOT_FEATURE_KEYS = (
    "icea_bridge",
    "icea_immediate_scoring",
    "icea_enriched_scoring",
    "icea_patient_risk",
    "governed_nnn",
    "admin_analytics",
    "ai_suggestions",
)
PILOT_FEATURE_SET = set(PILOT_FEATURE_KEYS)
PILOT_MODE_ALIASES = {
    "on": "enabled",
    "off": "disabled",
    "true": "enabled",
    "false": "disabled",
    "shadow_mode": "shadow",
}
PILOT_MODES = {"enabled", "disabled", "pilot", "demo", "shadow"}
ROLLOUT_STATUSES = {"go", "pause", "no-go"}
SUPPORTED_ENVIRONMENTS = {"development", "demo", "test", "pilot", "production"}
FEATURE_DEFAULT_ALLOWED_ROLES = {
    "admin_analytics": ["supervisor", "admin"],
    "icea_patient_risk": ["nurse", "supervisor", "admin"],
}
FEATURE_METADATA = {
    "icea_bridge": {
        "label": "ICEA bridge",
        "base_switches": (
            {"name": "ENABLE_ICEA_BRIDGE", "default": False},
        ),
        "shadow_accessible": True,
        "icea_related": True,
        "fallback": "HANDOVER mantiene FHIR, ETL y el flujo clínico base sin bridge ICEA.",
    },
    "icea_immediate_scoring": {
        "label": "Immediate scoring",
        "base_switches": (
            {"name": "ENABLE_ICEA_IMMEDIATE_SCORING", "default": False},
        ),
        "shadow_accessible": True,
        "icea_related": True,
        "fallback": "El bundle clínico sigue persistiendo; no se solicita score inmediato.",
    },
    "icea_enriched_scoring": {
        "label": "Enriched scoring",
        "base_switches": (
            {"name": "ENABLE_ICEA_ENRICHED_SCORING", "default": False},
        ),
        "shadow_accessible": True,
        "icea_related": True,
        "fallback": "El piloto continúa sin seguimiento enriquecido; permanece el score provisional o sin score.",
    },
    "icea_patient_risk": {
        "label": "Patient risk insights",
        "base_switches": (
            {"name": "ENABLE_ICEA_PATIENT_RISK", "default": False},
        ),
        "shadow_accessible": False,
        "icea_related": True,
        "fallback": "No se muestra apoyo individual ICEA; la valoración enfermera y el flujo clínico siguen intactos.",
    },
    "governed_nnn": {
        "label": "NNN governed features",
        "base_switches": (
            {"name": "SHOW_NIC_CODING", "default": False},
            {"name": "SHOW_NOC_OUTCOMES", "default": False},
        ),
        "shadow_accessible": False,
        "icea_related": False,
        "fallback": "Se conserva el registro clínico base y el texto libre; NIC/NOC/NANDA gobernado queda oculto.",
    },
    "admin_analytics": {
        "label": "Admin analytics blocks",
        "base_switches": (
            {"name": "ENABLE_ICEA_OPS_SUMMARY", "default": False},
            {"name": "ENABLE_ICEA_OPS_EVENTS", "default": False},
        ),
        "shadow_accessible": True,
        "icea_related": True,
        "fallback": "Las vistas analíticas/admin quedan fuera de servicio sin romper la operación asistencial.",
    },
    "ai_suggestions": {
        "label": "AI support suggestions",
        "base_switches": (
            {"name": "AI_SUGGESTIONS_ENABLED", "default": False},
        ),
        "shadow_accessible": False,
        "icea_related": False,
        "fallback": "Se mantiene el handover manual sin sugerencias IA.",
    },
}
KILL_SWITCH_FEATURES = (
    "admin_analytics",
    "icea_patient_risk",
    "governed_nnn",
    "ai_suggestions",
)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_mode(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = PILOT_MODE_ALIASES.get(value.strip().lower(), value.strip().lower())
    return normalized if normalized in PILOT_MODES else None


def _normalize_rollout_status(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized in ROLLOUT_STATUSES else None


def _normalize_text_list(value: Any, *, lower: bool = False) -> list[str]:
    if isinstance(value, str):
        values = [item.strip() for item in value.replace(",", " ").split() if item.strip()]
    elif isinstance(value, (list, tuple, set)):
        values = [str(item).strip() for item in value if str(item).strip()]
    else:
        values = []

    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        candidate = item.lower() if lower else item
        if candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _normalize_environment_scope(value: Any) -> list[str]:
    return [item for item in _normalize_text_list(value, lower=True) if item in SUPPORTED_ENVIRONMENTS]


def _feature_base_switches(feature_key: str) -> list[str]:
    metadata = FEATURE_METADATA[feature_key]
    return [str(item["name"]).strip() for item in metadata["base_switches"] if str(item.get("name") or "").strip()]


def _base_switch_enabled(feature_key: str) -> bool:
    metadata = FEATURE_METADATA[feature_key]
    return any(
        _env_bool(str(item["name"]), bool(item.get("default", False)))
        for item in metadata["base_switches"]
        if str(item.get("name") or "").strip()
    )


def _default_pilot_mode() -> str:
    deployment_mode = getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development")
    if deployment_mode == "demo":
        return "demo"
    if deployment_mode == "production":
        return "enabled"
    if deployment_mode in {"pilot", "test"}:
        return "pilot"
    return "disabled"


def _default_shadow_mode() -> bool:
    return getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development") == "pilot"


def _default_rollout_status(*, pilot_mode: str, explicit_shadow_mode_for_icea: bool) -> str:
    if pilot_mode == "disabled":
        return "no-go"
    if pilot_mode in {"demo", "pilot"} or explicit_shadow_mode_for_icea:
        return "pause"
    return "go"


def _default_feature_mode(feature_key: str, *, explicit_shadow_mode_for_icea: bool) -> str:
    if not _base_switch_enabled(feature_key):
        return "disabled"
    if explicit_shadow_mode_for_icea and FEATURE_METADATA[feature_key]["icea_related"]:
        return "shadow"
    if getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development") == "demo":
        return "demo"
    if getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development") == "pilot":
        return "pilot"
    return "enabled"


def _normalize_feature_rule(feature_key: str, value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    raw_shadow = value.get("shadow")
    if raw_shadow is None:
        raw_shadow = value.get("shadowMode")
    return {
        "mode": _normalize_mode(value.get("mode")),
        "enabledUnits": _normalize_text_list(value.get("enabledUnits")),
        "allowedRoles": _normalize_text_list(value.get("allowedRoles"), lower=True),
        "environmentScope": _normalize_environment_scope(value.get("environmentScope")),
        "shadow": bool(raw_shadow),
    }


def load_pilot_control_config() -> dict[str, Any]:
    raw = (os.getenv("HANDOVER_PILOT_CONTROL_JSON") or "").strip()
    try:
        payload = json.loads(raw) if raw else {}
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    pilot_mode = _normalize_mode(payload.get("pilotMode")) or _default_pilot_mode()
    explicit_shadow_mode_for_icea = bool(payload.get("explicitShadowModeForIcea"))
    if not raw:
        explicit_shadow_mode_for_icea = _default_shadow_mode()
    rollout_status = (
        _normalize_rollout_status(payload.get("rolloutStatus"))
        or _default_rollout_status(
            pilot_mode=pilot_mode,
            explicit_shadow_mode_for_icea=explicit_shadow_mode_for_icea,
        )
    )
    enabled_units = _normalize_text_list(payload.get("enabledUnits"))
    allowed_roles = _normalize_text_list(payload.get("allowedRoles"), lower=True)
    environment_scope = _normalize_environment_scope(payload.get("environmentScope"))

    features_payload = payload.get("features") if isinstance(payload.get("features"), dict) else {}
    features = {
        feature_key: _normalize_feature_rule(feature_key, features_payload.get(feature_key))
        for feature_key in PILOT_FEATURE_KEYS
    }

    return {
        "pilotMode": pilot_mode,
        "rolloutStatus": rollout_status,
        "rolloutStatusExplicit": "rolloutStatus" in payload,
        "enabledUnits": enabled_units,
        "allowedRoles": allowed_roles,
        "environmentScope": environment_scope,
        "explicitShadowModeForIcea": explicit_shadow_mode_for_icea,
        "features": features,
    }


def _feature_scope(
    config: dict[str, Any],
    feature_key: str,
    *,
    governance_only: bool = False,
) -> dict[str, Any]:
    feature = config["features"][feature_key]
    if governance_only:
        mode = feature["mode"] or config["pilotMode"]
    else:
        mode = feature["mode"] or _default_feature_mode(
            feature_key,
            explicit_shadow_mode_for_icea=config["explicitShadowModeForIcea"],
        )
    allowed_roles = (
        feature["allowedRoles"]
        or config["allowedRoles"]
        or FEATURE_DEFAULT_ALLOWED_ROLES.get(feature_key, [])
    )
    return {
        "mode": mode,
        "enabledUnits": feature["enabledUnits"] or config["enabledUnits"],
        "allowedRoles": allowed_roles,
        "environmentScope": feature["environmentScope"] or config["environmentScope"],
        "shadow": bool(feature["shadow"]) or mode == "shadow" or (
            config["explicitShadowModeForIcea"] and FEATURE_METADATA[feature_key]["icea_related"]
        ),
    }


def resolve_roles_from_request(request) -> list[str]:
    claims = getattr(request, "auth", None)
    if not isinstance(claims, dict):
        claims = getattr(getattr(request, "user", None), "claims", None)
    if not isinstance(claims, dict):
        return []
    return sorted(extract_roles(claims))


def evaluate_pilot_feature(
    feature_key: str,
    *,
    unit_id: str | None = None,
    roles: list[str] | tuple[str, ...] | set[str] | None = None,
    environment: str | None = None,
    governance_only: bool = False,
) -> dict[str, Any]:
    if feature_key not in PILOT_FEATURE_SET:
        raise KeyError(f"Unsupported pilot feature: {feature_key}")

    config = load_pilot_control_config()
    scope = _feature_scope(config, feature_key, governance_only=governance_only)
    effective_environment = (environment or getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development")).strip().lower()
    normalized_unit_id = (unit_id or "").strip()
    normalized_roles = _normalize_text_list(roles or [], lower=True)
    metadata = FEATURE_METADATA[feature_key]
    base_switch_enabled = _base_switch_enabled(feature_key)
    rollout_status = config["rolloutStatus"]
    rollout_status_explicit = bool(config.get("rolloutStatusExplicit"))
    environment_scope = scope["environmentScope"]
    enabled_units = scope["enabledUnits"]
    allowed_roles = scope["allowedRoles"]
    rollout_forces_shadow = rollout_status_explicit and rollout_status == "pause" and metadata["icea_related"]
    effective_shadow_mode = bool(scope["shadow"]) or rollout_forces_shadow

    denial_reason = None
    enabled = True

    if not base_switch_enabled and not governance_only:
        enabled = False
        denial_reason = "kill_switch_disabled"
    elif rollout_status_explicit and rollout_status == "no-go":
        enabled = False
        denial_reason = "rollout_no_go"
    elif scope["mode"] == "disabled":
        enabled = False
        denial_reason = "pilot_control_disabled"
    elif scope["mode"] == "demo" and effective_environment != "demo":
        enabled = False
        denial_reason = "demo_only"
    elif environment_scope and effective_environment not in environment_scope:
        enabled = False
        denial_reason = "environment_out_of_scope"
    elif enabled_units and normalized_unit_id and normalized_unit_id not in enabled_units:
        enabled = False
        denial_reason = "unit_out_of_scope"
    elif allowed_roles and normalized_roles and not (set(normalized_roles) & set(allowed_roles)):
        enabled = False
        denial_reason = "role_out_of_scope"
    elif effective_shadow_mode and not metadata["shadow_accessible"]:
        enabled = False
        denial_reason = "rollout_paused" if rollout_forces_shadow else "shadow_mode"

    return {
        "key": feature_key,
        "label": metadata["label"],
        "mode": scope["mode"],
        "enabled": enabled,
        "shadowMode": effective_shadow_mode,
        "pilotMode": config["pilotMode"],
        "rolloutStatus": rollout_status,
        "baseSwitchEnabled": base_switch_enabled,
        "environment": effective_environment,
        "environmentScope": environment_scope,
        "enabledUnits": enabled_units,
        "allowedRoles": allowed_roles,
        "fallback": metadata["fallback"],
        "baseSwitches": _feature_base_switches(feature_key),
        "denialReason": denial_reason,
    }


def evaluate_pilot_feature_governance(
    feature_key: str,
    *,
    unit_id: str | None = None,
    roles: list[str] | tuple[str, ...] | set[str] | None = None,
    environment: str | None = None,
) -> dict[str, Any]:
    return evaluate_pilot_feature(
        feature_key,
        unit_id=unit_id,
        roles=roles,
        environment=environment,
        governance_only=True,
    )


def is_pilot_feature_enabled(
    feature_key: str,
    *,
    unit_id: str | None = None,
    roles: list[str] | tuple[str, ...] | set[str] | None = None,
    environment: str | None = None,
) -> bool:
    return bool(
        evaluate_pilot_feature(
            feature_key,
            unit_id=unit_id,
            roles=roles,
            environment=environment,
        )["enabled"]
    )


def serialize_pilot_control_summary(
    *,
    unit_id: str | None = None,
    roles: list[str] | tuple[str, ...] | set[str] | None = None,
    environment: str | None = None,
) -> dict[str, Any]:
    config = load_pilot_control_config()
    effective_environment = (environment or getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development")).strip().lower()
    normalized_unit_id = (unit_id or "").strip() or None
    normalized_roles = _normalize_text_list(roles or [], lower=True)
    features = {
        feature_key: evaluate_pilot_feature(
            feature_key,
            unit_id=normalized_unit_id,
            roles=normalized_roles,
            environment=effective_environment,
        )
        for feature_key in PILOT_FEATURE_KEYS
    }
    kill_switches = [
        {
            "key": feature_key,
            "effective": not features[feature_key]["enabled"],
            "mode": features[feature_key]["mode"],
            "shadowMode": features[feature_key]["shadowMode"],
            "baseSwitches": features[feature_key]["baseSwitches"],
            "fallback": features[feature_key]["fallback"],
            "reason": features[feature_key]["denialReason"],
        }
        for feature_key in KILL_SWITCH_FEATURES
    ]
    return {
        "generatedAt": timezone.now().isoformat(),
        "pilotMode": config["pilotMode"],
        "rolloutStatus": config["rolloutStatus"],
        "environment": effective_environment,
        "enabledUnits": config["enabledUnits"],
        "allowedRoles": config["allowedRoles"],
        "environmentScope": config["environmentScope"],
        "explicitShadowModeForIcea": config["explicitShadowModeForIcea"],
        "requestedContext": {
            "unitId": normalized_unit_id,
            "roles": normalized_roles,
        },
        "features": features,
        "killSwitches": kill_switches,
        "stateChangeAuditLimit": "env_backed_read_only_control_plane",
    }


def serialize_pilot_control_features(
    *,
    unit_id: str | None = None,
    roles: list[str] | tuple[str, ...] | set[str] | None = None,
    environment: str | None = None,
) -> dict[str, Any]:
    effective_environment = (environment or getattr(settings, "HANDOVER_DEPLOYMENT_MODE", "development")).strip().lower()
    normalized_unit_id = (unit_id or "").strip() or None
    normalized_roles = _normalize_text_list(roles or [], lower=True)
    features = {
        feature_key: evaluate_pilot_feature(
            feature_key,
            unit_id=normalized_unit_id,
            roles=normalized_roles,
            environment=effective_environment,
        )
        for feature_key in PILOT_FEATURE_KEYS
    }
    return {
        "generatedAt": timezone.now().isoformat(),
        "requestedContext": {
            "unitId": normalized_unit_id,
            "roles": normalized_roles,
        },
        "features": {
            feature_key: {
                "enabled": feature_state["enabled"],
                "shadow": feature_state["shadowMode"],
                "pilotMode": feature_state["pilotMode"],
                "mode": feature_state["mode"],
                "denialReason": feature_state["denialReason"],
            }
            for feature_key, feature_state in features.items()
        },
        "stateChangeAuditLimit": "backend_effective_read_only_control_plane",
    }
