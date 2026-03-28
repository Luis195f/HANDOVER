import { useEffect, useMemo, useSyncExternalStore } from 'react';

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
export type PilotMode = 'enabled' | 'disabled' | 'pilot' | 'demo';
export type PilotDenialReason =
  | 'backend_unavailable'
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

export interface PilotFeatureState {
  key: PilotFeatureKey;
  mode: PilotFeatureMode;
  enabled: boolean;
  shadow: boolean;
  pilotMode: PilotMode;
  environment: PilotEnvironment;
  enabledUnits: string[];
  allowedRoles: string[];
  environmentScope: PilotEnvironment[];
  denialReason: PilotDenialReason;
  source: 'backend' | 'fallback';
}

interface PilotFeatureContext {
  unitId?: string | null;
  roles?: string[] | null;
}

interface NormalizedPilotContext {
  unitId: string | null;
  roles: string[];
}

interface PilotControlFeatureRule {
  mode?: PilotFeatureMode;
  enabledUnits?: string[];
  allowedRoles?: string[];
  environmentScope?: PilotEnvironment[];
  shadow?: boolean;
}

interface PilotControlConfig {
  legacyPayloadPresent: boolean;
  pilotMode: PilotMode;
  rolloutStatus: 'go' | 'pause' | 'no-go';
  rolloutStatusExplicit: boolean;
  enabledUnits: string[];
  allowedRoles: string[];
  environmentScope: PilotEnvironment[];
  explicitShadowModeForIcea: boolean;
  features: Record<PilotFeatureKey, PilotControlFeatureRule>;
}

interface BackendPilotFeatureState {
  enabled: boolean;
  shadow: boolean;
  pilotMode: PilotMode;
  mode: PilotFeatureMode;
  denialReason: Exclude<PilotDenialReason, 'backend_unavailable'>;
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
const PILOT_DENIAL_REASONS = new Set<Exclude<PilotDenialReason, null>>([
  'kill_switch_disabled',
  'pilot_control_disabled',
  'demo_only',
  'environment_out_of_scope',
  'unit_out_of_scope',
  'role_out_of_scope',
  'rollout_paused',
  'rollout_no_go',
  'shadow_mode',
]);

const backendFeatureCache = new Map<string, Record<PilotFeatureKey, BackendPilotFeatureState>>();
const inflightBackendFetches = new Map<string, Promise<void>>();
const backendFeatureSubscribers = new Set<() => void>();
let backendFeatureSnapshot = 0;

function notifyBackendFeatureSubscribers() {
  backendFeatureSnapshot += 1;
  for (const listener of backendFeatureSubscribers) {
    listener();
  }
}

function subscribeToBackendFeatures(listener: () => void) {
  backendFeatureSubscribers.add(listener);
  return () => {
    backendFeatureSubscribers.delete(listener);
  };
}

function getBackendFeatureSnapshot() {
  return backendFeatureSnapshot;
}

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

function normalizePilotContext(context: PilotFeatureContext = {}): NormalizedPilotContext {
  const unitId = typeof context.unitId === 'string' ? context.unitId.trim() : '';
  return {
    unitId: unitId || null,
    roles: [...normalizeTextList(context.roles ?? [], true)].sort(),
  };
}

function getPilotContextCacheKey(context: PilotFeatureContext = {}): string {
  const normalized = normalizePilotContext(context);
  return `${normalized.unitId ?? ''}::${normalized.roles.join(',')}`;
}

function buildPilotFeaturesPath(context: NormalizedPilotContext): string {
  if (!context.unitId) {
    return '/api/pilot-control/features';
  }
  return `/api/pilot-control/features?unitId=${encodeURIComponent(context.unitId)}`;
}

function isPilotFeatureKey(value: string): value is PilotFeatureKey {
  return FEATURE_KEYS.includes(value as PilotFeatureKey);
}

function isPilotMode(value: unknown): value is PilotMode {
  return value === 'enabled' || value === 'disabled' || value === 'pilot' || value === 'demo';
}

function isPilotDenialReason(value: unknown): value is Exclude<PilotDenialReason, 'backend_unavailable' | null> {
  return typeof value === 'string' && PILOT_DENIAL_REASONS.has(value as Exclude<PilotDenialReason, null>);
}

function parseBackendPilotFeatureState(value: unknown): BackendPilotFeatureState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const mode = normalizeMode(candidate.mode);
  if (!mode) return null;
  if (typeof candidate.enabled !== 'boolean') return null;
  if (typeof candidate.shadow !== 'boolean') return null;
  if (!isPilotMode(candidate.pilotMode)) return null;
  const denialReason =
    candidate.denialReason == null
      ? null
      : isPilotDenialReason(candidate.denialReason)
        ? candidate.denialReason
        : null;
  if (candidate.denialReason != null && denialReason == null) return null;
  return {
    enabled: candidate.enabled,
    shadow: candidate.shadow,
    pilotMode: candidate.pilotMode,
    mode,
    denialReason,
  };
}

function parseBackendPilotFeatureMap(value: unknown): Record<PilotFeatureKey, BackendPilotFeatureState> | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const features = payload.features;
  if (!features || typeof features !== 'object') return null;

  const normalized = {} as Record<PilotFeatureKey, BackendPilotFeatureState>;
  for (const [rawKey, rawValue] of Object.entries(features as Record<string, unknown>)) {
    if (!isPilotFeatureKey(rawKey)) continue;
    const parsed = parseBackendPilotFeatureState(rawValue);
    if (!parsed) return null;
    normalized[rawKey] = parsed;
  }

  for (const featureKey of FEATURE_KEYS) {
    if (!(featureKey in normalized)) {
      return null;
    }
  }

  return normalized;
}

function setBackendPilotFeatureMap(
  cacheKey: string,
  value: Record<PilotFeatureKey, BackendPilotFeatureState> | null,
) {
  if (value) {
    backendFeatureCache.set(cacheKey, value);
    notifyBackendFeatureSubscribers();
    return;
  }

  if (backendFeatureCache.delete(cacheKey)) {
    notifyBackendFeatureSubscribers();
  }
}

function getBackendPilotFeatureState(
  featureKey: PilotFeatureKey,
  context: PilotFeatureContext = {},
): BackendPilotFeatureState | null {
  const cacheKey = getPilotContextCacheKey(context);
  return backendFeatureCache.get(cacheKey)?.[featureKey] ?? null;
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

function defaultPilotMode(environment: PilotEnvironment): PilotMode {
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
  const pilotMode = (normalizeMode(payload.pilotMode) as PilotMode | null) ?? defaultPilotMode(environment);
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
    legacyPayloadPresent: raw.trim().length > 0,
    pilotMode,
    rolloutStatus,
    rolloutStatusExplicit: Object.prototype.hasOwnProperty.call(payload, 'rolloutStatus'),
    enabledUnits: normalizeTextList(payload.enabledUnits),
    allowedRoles: normalizeTextList(payload.allowedRoles, true),
    environmentScope: normalizeEnvironmentScope(payload.environmentScope),
    explicitShadowModeForIcea,
    features: FEATURE_KEYS.reduce(
      (acc, key) => {
        const featurePayload =
          featuresPayload[key] && typeof featuresPayload[key] === 'object'
            ? (featuresPayload[key] as Record<string, unknown>)
            : null;
        return {
          ...acc,
          [key]: featurePayload
            ? {
                mode: normalizeMode(featurePayload.mode) ?? undefined,
                enabledUnits: normalizeTextList(featurePayload.enabledUnits),
                allowedRoles: normalizeTextList(featurePayload.allowedRoles, true),
                environmentScope: normalizeEnvironmentScope(featurePayload.environmentScope),
                shadow: Boolean(featurePayload.shadow ?? featurePayload.shadowMode),
              }
            : {},
        };
      },
      {} as Record<PilotFeatureKey, PilotControlFeatureRule>,
    ),
  };
}

function resolveConservativeFallbackState(
  featureKey: PilotFeatureKey,
  context: PilotFeatureContext = {},
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
  const shadow =
    Boolean(feature.shadow) ||
    mode === 'shadow' ||
    (config.explicitShadowModeForIcea && FEATURE_METADATA[featureKey].iceaRelated) ||
    rolloutForcesShadow;
  const normalizedContext = normalizePilotContext(context);

  let enabled = true;
  let denialReason: PilotDenialReason = null;

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
  } else if (enabledUnits.length > 0 && normalizedContext.unitId && !enabledUnits.includes(normalizedContext.unitId)) {
    enabled = false;
    denialReason = 'unit_out_of_scope';
  } else if (
    allowedRoles.length > 0 &&
    normalizedContext.roles.length > 0 &&
    !normalizedContext.roles.some((role) => allowedRoles.includes(role))
  ) {
    enabled = false;
    denialReason = 'role_out_of_scope';
  } else if (shadow && !FEATURE_METADATA[featureKey].shadowAccessible) {
    enabled = false;
    denialReason = rolloutForcesShadow ? 'rollout_paused' : 'shadow_mode';
  }

  if (
    enabled &&
    (config.legacyPayloadPresent || environment === 'pilot' || environment === 'production' || environment === 'demo')
  ) {
    enabled = false;
    denialReason = 'backend_unavailable';
  }

  return {
    key: featureKey,
    mode,
    enabled,
    shadow,
    pilotMode: config.pilotMode,
    environment,
    enabledUnits,
    allowedRoles,
    environmentScope,
    denialReason,
    source: 'fallback',
  };
}

function resolveBackendState(
  featureKey: PilotFeatureKey,
  context: PilotFeatureContext = {},
): PilotFeatureState | null {
  const backendState = getBackendPilotFeatureState(featureKey, context);
  if (!backendState) return null;
  return {
    key: featureKey,
    mode: backendState.mode,
    enabled: backendState.enabled,
    shadow: backendState.shadow,
    pilotMode: backendState.pilotMode,
    environment: resolveEnvironment(),
    enabledUnits: [],
    allowedRoles: [],
    environmentScope: [],
    denialReason: backendState.denialReason,
    source: 'backend',
  };
}

export async function refreshPilotControlContext(context: PilotFeatureContext = {}): Promise<void> {
  const normalizedContext = normalizePilotContext(context);
  const cacheKey = getPilotContextCacheKey(normalizedContext);
  const existing = inflightBackendFetches.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const request = (async () => {
    try {
      const { apiGet } = await import('@/src/lib/api');
      const response = await apiGet(buildPilotFeaturesPath(normalizedContext));
      const parsed = parseBackendPilotFeatureMap(response);
      if (!parsed) {
        throw new Error('invalid_pilot_control_features_payload');
      }
      setBackendPilotFeatureMap(cacheKey, parsed);
    } catch {
      setBackendPilotFeatureMap(cacheKey, null);
    } finally {
      inflightBackendFetches.delete(cacheKey);
    }
  })();

  inflightBackendFetches.set(cacheKey, request);
  await request;
}

export function usePilotControlContext(context: PilotFeatureContext = {}): number {
  const snapshot = useSyncExternalStore(
    subscribeToBackendFeatures,
    getBackendFeatureSnapshot,
    getBackendFeatureSnapshot,
  );
  const contextKey = getPilotContextCacheKey(context);
  const normalizedContext = useMemo(() => normalizePilotContext(context), [contextKey]);

  useEffect(() => {
    void refreshPilotControlContext(normalizedContext);
  }, [contextKey, normalizedContext]);

  return snapshot;
}

export function resolvePilotFeatureState(
  featureKey: PilotFeatureKey,
  context: PilotFeatureContext = {},
): PilotFeatureState {
  return resolveBackendState(featureKey, context) ?? resolveConservativeFallbackState(featureKey, context);
}

export function isPilotFeatureEnabled(
  featureKey: PilotFeatureKey,
  context: PilotFeatureContext = {},
): boolean {
  return resolvePilotFeatureState(featureKey, context).enabled;
}
