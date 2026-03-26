import { getAppConfigExtra } from '@/src/config/app-config';

export type PilotFeatureKey =
  | 'icea_bridge'
  | 'icea_immediate_scoring'
  | 'icea_enriched_scoring'
  | 'icea_patient_risk'
  | 'governed_nnn'
  | 'admin_analytics'
  | 'ai_suggestions';

export type PilotFeatureMode = 'enabled' | 'disabled' | 'pilot' | 'demo' | 'shadow';
export type PilotEnvironment = 'development' | 'demo' | 'test' | 'pilot' | 'production';

export interface PilotFeatureState {
  key: PilotFeatureKey;
  mode: PilotFeatureMode;
  enabled: boolean;
  shadowMode: boolean;
  pilotMode: 'enabled' | 'disabled' | 'pilot' | 'demo';
  environment: PilotEnvironment;
  enabledUnits: string[];
  allowedRoles: string[];
  environmentScope: PilotEnvironment[];
  denialReason:
    | 'kill_switch_disabled'
    | 'pilot_control_disabled'
    | 'demo_only'
    | 'environment_out_of_scope'
    | 'unit_out_of_scope'
    | 'role_out_of_scope'
    | 'rollout_paused'
    | 'rollout_no_go'
    | 'shadow_mode'
    | null;
}

interface PilotControlFeatureRule {
  mode?: PilotFeatureMode;
  enabledUnits?: string[];
  allowedRoles?: string[];
  environmentScope?: PilotEnvironment[];
  shadowMode?: boolean;
}

interface PilotControlConfig {
  pilotMode: 'enabled' | 'disabled' | 'pilot' | 'demo';
  rolloutStatus: 'go' | 'pause' | 'no-go';
  rolloutStatusExplicit: boolean;
  enabledUnits: string[];
  allowedRoles: string[];
  environmentScope: PilotEnvironment[];
  explicitShadowModeForIcea: boolean;
  features: Record<PilotFeatureKey, PilotControlFeatureRule>;
}

const extra = getAppConfigExtra();
const FEATURE_KEYS: PilotFeatureKey[] = [
  'icea_bridge',
  'icea_immediate_scoring',
  'icea_enriched_scoring',
  'icea_patient_risk',
  'governed_nnn',
  'admin_analytics',
  'ai_suggestions',
];
const FEATURE_DEFAULT_ALLOWED_ROLES: Partial<Record<PilotFeatureKey, string[]>> = {
  admin_analytics: ['supervisor', 'admin'],
  icea_patient_risk: ['nurse', 'supervisor', 'admin'],
};
const FEATURE_METADATA: Record<
  PilotFeatureKey,
  { envVar?: string; iceaRelated: boolean; shadowAccessible: boolean }
> = {
  icea_bridge: {
    envVar: 'EXPO_PUBLIC_ENABLE_ICEA_BRIDGE',
    iceaRelated: true,
    shadowAccessible: true,
  },
  icea_immediate_scoring: {
    envVar: 'EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING',
    iceaRelated: true,
    shadowAccessible: true,
  },
  icea_enriched_scoring: {
    envVar: 'EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING',
    iceaRelated: true,
    shadowAccessible: true,
  },
  icea_patient_risk: {
    envVar: 'EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK',
    iceaRelated: true,
    shadowAccessible: false,
  },
  governed_nnn: {
    iceaRelated: false,
    shadowAccessible: false,
  },
  admin_analytics: {
    iceaRelated: true,
    shadowAccessible: true,
  },
  ai_suggestions: {
    envVar: 'EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED',
    iceaRelated: false,
    shadowAccessible: false,
  },
};

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeMode(value: unknown): PilotFeatureMode | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'enabled':
    case 'disabled':
    case 'pilot':
    case 'demo':
    case 'shadow':
      return normalized;
    case 'on':
    case 'true':
      return 'enabled';
    case 'off':
    case 'false':
      return 'disabled';
    default:
      return null;
  }
}

function normalizeTextList(value: unknown, lower = false): string[] {
  const values = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === 'string'
      ? value
          .replace(/,/g, ' ')
          .split(/\s+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of values) {
    const candidate = lower ? item.toLowerCase() : item;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeEnvironmentScope(value: unknown): PilotEnvironment[] {
  return normalizeTextList(value, true).filter((item): item is PilotEnvironment =>
    ['development', 'demo', 'test', 'pilot', 'production'].includes(item),
  );
}

function baseSwitchEnabled(featureKey: PilotFeatureKey): boolean {
  if (featureKey === 'governed_nnn') {
    return truthy(process.env.EXPO_PUBLIC_SHOW_NIC_CODING) || truthy(process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES);
  }
  if (featureKey === 'admin_analytics') {
    return true;
  }
  const envVar = FEATURE_METADATA[featureKey].envVar;
  return envVar ? truthy(process.env[envVar]) : false;
}

function resolveEnvironment(): PilotEnvironment {
  const raw =
    (typeof extra.HANDOVER_DEPLOYMENT_MODE === 'string' ? extra.HANDOVER_DEPLOYMENT_MODE : undefined) ??
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE ??
    (process.env.NODE_ENV === 'test' ? 'test' : undefined) ??
    'development';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'demo') return 'demo';
  if (normalized === 'pilot') return 'pilot';
  if (normalized === 'production') return 'production';
  if (normalized === 'test') return 'test';
  return 'development';
}

function defaultPilotMode(environment: PilotEnvironment): PilotControlConfig['pilotMode'] {
  if (environment === 'demo') return 'demo';
  if (environment === 'production') return 'enabled';
  if (environment === 'pilot' || environment === 'test') return 'pilot';
  return 'disabled';
}

function defaultFeatureMode(
  featureKey: PilotFeatureKey,
  environment: PilotEnvironment,
  explicitShadowModeForIcea: boolean,
): PilotFeatureMode {
  if (!baseSwitchEnabled(featureKey)) return 'disabled';
  if (explicitShadowModeForIcea && FEATURE_METADATA[featureKey].iceaRelated) return 'shadow';
  if (environment === 'demo') return 'demo';
  if (environment === 'pilot') return 'pilot';
  return 'enabled';
}

function loadPilotControlConfig(): PilotControlConfig {
  const raw =
    (typeof extra.HANDOVER_PILOT_CONTROL_JSON === 'string' ? extra.HANDOVER_PILOT_CONTROL_JSON : undefined) ??
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON ??
    '';
  let parsed: unknown = {};
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const environment = resolveEnvironment();
  const pilotMode = (normalizeMode(payload.pilotMode) as PilotControlConfig['pilotMode'] | null) ?? defaultPilotMode(environment);
  const explicitShadowModeForIcea =
    typeof payload.explicitShadowModeForIcea === 'boolean'
      ? payload.explicitShadowModeForIcea
      : environment === 'pilot';
  const rolloutStatus =
    typeof payload.rolloutStatus === 'string' &&
    ['go', 'pause', 'no-go'].includes(payload.rolloutStatus.trim().toLowerCase())
      ? (payload.rolloutStatus.trim().toLowerCase() as PilotControlConfig['rolloutStatus'])
      : pilotMode === 'disabled'
        ? 'no-go'
        : pilotMode === 'demo' || pilotMode === 'pilot' || explicitShadowModeForIcea
          ? 'pause'
          : 'go';
  const featuresPayload = payload.features && typeof payload.features === 'object' ? (payload.features as Record<string, unknown>) : {};
  return {
    pilotMode,
    rolloutStatus,
    rolloutStatusExplicit: Object.prototype.hasOwnProperty.call(payload, 'rolloutStatus'),
    enabledUnits: normalizeTextList(payload.enabledUnits),
    allowedRoles: normalizeTextList(payload.allowedRoles, true),
    environmentScope: normalizeEnvironmentScope(payload.environmentScope),
    explicitShadowModeForIcea,
    features: FEATURE_KEYS.reduce(
      (acc, key) => ({
        ...acc,
        [key]:
          featuresPayload[key] && typeof featuresPayload[key] === 'object'
            ? {
                mode: normalizeMode((featuresPayload[key] as Record<string, unknown>).mode) ?? undefined,
                enabledUnits: normalizeTextList((featuresPayload[key] as Record<string, unknown>).enabledUnits),
                allowedRoles: normalizeTextList((featuresPayload[key] as Record<string, unknown>).allowedRoles, true),
                environmentScope: normalizeEnvironmentScope((featuresPayload[key] as Record<string, unknown>).environmentScope),
                shadowMode: Boolean((featuresPayload[key] as Record<string, unknown>).shadowMode),
              }
            : {},
      }),
      {} as Record<PilotFeatureKey, PilotControlFeatureRule>,
    ),
  };
}

export function resolvePilotFeatureState(
  featureKey: PilotFeatureKey,
  context: { unitId?: string | null; roles?: string[] | null } = {},
): PilotFeatureState {
  const config = loadPilotControlConfig();
  const environment = resolveEnvironment();
  const feature = config.features[featureKey] ?? {};
  const enabledUnits = feature.enabledUnits?.length ? feature.enabledUnits : config.enabledUnits;
  const allowedRoles =
    feature.allowedRoles?.length
      ? feature.allowedRoles
      : config.allowedRoles.length
        ? config.allowedRoles
        : FEATURE_DEFAULT_ALLOWED_ROLES[featureKey] ?? [];
  const environmentScope = feature.environmentScope?.length ? feature.environmentScope : config.environmentScope;
  const mode =
    feature.mode ?? defaultFeatureMode(featureKey, environment, config.explicitShadowModeForIcea);
  const rolloutForcesShadow =
    config.rolloutStatusExplicit && config.rolloutStatus === 'pause' && FEATURE_METADATA[featureKey].iceaRelated;
  const shadowMode =
    Boolean(feature.shadowMode) ||
    mode === 'shadow' ||
    (config.explicitShadowModeForIcea && FEATURE_METADATA[featureKey].iceaRelated) ||
    rolloutForcesShadow;
  const normalizedUnitId = context.unitId?.trim() ?? '';
  const normalizedRoles = normalizeTextList(context.roles ?? [], true);

  let enabled = true;
  let denialReason: PilotFeatureState['denialReason'] = null;

  if (!baseSwitchEnabled(featureKey)) {
    enabled = false;
    denialReason = 'kill_switch_disabled';
  } else if (config.rolloutStatusExplicit && config.rolloutStatus === 'no-go') {
    enabled = false;
    denialReason = 'rollout_no_go';
  } else if (mode === 'disabled') {
    enabled = false;
    denialReason = 'pilot_control_disabled';
  } else if (mode === 'demo' && environment !== 'demo') {
    enabled = false;
    denialReason = 'demo_only';
  } else if (environmentScope.length > 0 && !environmentScope.includes(environment)) {
    enabled = false;
    denialReason = 'environment_out_of_scope';
  } else if (enabledUnits.length > 0 && normalizedUnitId && !enabledUnits.includes(normalizedUnitId)) {
    enabled = false;
    denialReason = 'unit_out_of_scope';
  } else if (allowedRoles.length > 0 && normalizedRoles.length > 0 && !normalizedRoles.some((role) => allowedRoles.includes(role))) {
    enabled = false;
    denialReason = 'role_out_of_scope';
  } else if (shadowMode && !FEATURE_METADATA[featureKey].shadowAccessible) {
    enabled = false;
    denialReason = rolloutForcesShadow ? 'rollout_paused' : 'shadow_mode';
  }

  return {
    key: featureKey,
    mode,
    enabled,
    shadowMode,
    pilotMode: config.pilotMode,
    environment,
    enabledUnits,
    allowedRoles,
    environmentScope,
    denialReason,
  };
}

export function isPilotFeatureEnabled(
  featureKey: PilotFeatureKey,
  context: { unitId?: string | null; roles?: string[] | null } = {},
): boolean {
  return resolvePilotFeatureState(featureKey, context).enabled;
}
