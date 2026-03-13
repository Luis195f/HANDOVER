export const HANDOVER_CORE_PROFILE_ID = 'handover-core' as const;

export const UNIT_PROFILE_IDS = [
  'emergency',
  'general-inpatient',
  'critical-care',
  'pediatric-critical-care',
  'specialized-critical-care',
  'maternal-perinatal',
  'perioperative',
  'ambulatory',
  'rehabilitation',
  'long-term-care',
  'behavioral-health',
  'home-care',
] as const;

export const SPECIALTY_OVERLAY_IDS = [
  'cvicu',
  'neuroicu',
  'onc',
  'trauma',
  'neph',
  'gastro',
  'endo',
  'pulm',
  'infect',
  'ped',
  'ob',
  'ent',
  'burns',
  'critical-emergency',
  'transplant',
] as const;

export const LEGACY_UNIT_PROFILE_ALIASES = {
  pediatrics: 'general-inpatient',
} as const;

export const LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES = {
  oncology: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
} as const;

export const LEGACY_SPECIALTY_OVERLAY_ALIASES = {
  gyn: 'ob',
} as const;

const UNIT_PROFILE_ID_SET = new Set<string>(UNIT_PROFILE_IDS);
const SPECIALTY_OVERLAY_ID_SET = new Set<string>(SPECIALTY_OVERLAY_IDS);

const ONCOLOGY_HOME_CARE_HINTS = ['home', 'domic', 'paliativ', 'hospice'];
const ONCOLOGY_EMERGENCY_HINTS = ['emergenc', 'urgenc', 'resucit', 'triage', 'observacion', 'urgent'];
const ONCOLOGY_AMBULATORY_HINTS = [
  'ambulat',
  'consulta-externa',
  'outpatient',
  'hospital-de-dia',
  'day-hospital',
  'day-care',
  'infusion',
  'clinic',
];
const ONCOLOGY_INPATIENT_HINTS = ['hospitalizacion', 'inpatient', 'ward', 'piso', 'floor', 'planta', 'room', 'sala'];

export type HandoverCoreProfileId = typeof HANDOVER_CORE_PROFILE_ID;
export type UnitProfileId = (typeof UNIT_PROFILE_IDS)[number];
export type SpecialtyOverlayId = (typeof SPECIALTY_OVERLAY_IDS)[number];
export type LegacyUnitProfileAlias = keyof typeof LEGACY_UNIT_PROFILE_ALIASES;
export type LegacyContextualUnitProfileAlias = keyof typeof LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES;
export type LegacySpecialtyOverlayAlias = keyof typeof LEGACY_SPECIALTY_OVERLAY_ALIASES;
export type ProfileSelectorId = HandoverCoreProfileId | UnitProfileId | SpecialtyOverlayId;
export type ProfileCatalogReadiness = 'wave-1' | 'scaffold';

export type ContextualPriorityDimension =
  | 'instability'
  | 'deterioration-risk'
  | 'dependency'
  | 'therapeutic-load'
  | 'time-critical'
  | 'omission-risk'
  | 'coordination'
  | 'unit-modifier'
  | 'specialty-modifier';

export interface LegacyUnitProfileResolutionContext {
  unitId?: string | null;
  unitName?: string | null;
  specialtyId?: string | null;
}

export interface ContextualPrioritySignal {
  id: string;
  label: string;
  dimension: ContextualPriorityDimension;
  source: 'core' | 'unit-profile' | 'specialty-overlay';
  profileId?: UnitProfileId | SpecialtyOverlayId;
  weight?: number;
  explanation?: string;
}

export interface IceaContextVector {
  baselineComplexity?: number;
  surveillanceIntensity?: number;
  therapeuticLoad?: number;
  temporalCriticality?: number;
  continuityRisk?: number;
  dependencyLoad?: number;
  coordinationComplexity?: number;
  caseMixHints?: readonly string[];
}

export interface ProfileActivation {
  enabledByDefault: boolean;
  stage: 'catalog' | 'pilot' | 'active';
}

export interface CoreProfileDefinition {
  id: HandoverCoreProfileId;
  kind: 'core';
  label: string;
  description: string;
  enabledSections: readonly string[];
  prioritySignals: readonly ContextualPrioritySignal[];
  iceaContextDefaults: Readonly<Partial<IceaContextVector>>;
}

export interface UnitProfileDefinition {
  id: UnitProfileId;
  kind: 'unit-profile';
  label: string;
  description: string;
  aliases?: readonly string[];
  readiness: ProfileCatalogReadiness;
  activation: ProfileActivation;
  enabledSections?: readonly string[];
  visibilityRules?: readonly string[];
  prioritySignals?: readonly ContextualPrioritySignal[];
  iceaContextDefaults?: Readonly<Partial<IceaContextVector>>;
}

export interface SpecialtyOverlayDefinition {
  id: SpecialtyOverlayId;
  kind: 'specialty-overlay';
  label: string;
  description: string;
  aliases?: readonly string[];
  readiness: ProfileCatalogReadiness;
  activation: ProfileActivation;
  allowedUnitProfiles?: readonly UnitProfileId[];
  prioritySignals?: readonly ContextualPrioritySignal[];
  iceaContextDefaults?: Readonly<Partial<IceaContextVector>>;
}

export interface ProfileRegistry {
  core: CoreProfileDefinition;
  unitProfiles: Readonly<Record<UnitProfileId, UnitProfileDefinition>>;
  specialtyOverlays: Readonly<Record<SpecialtyOverlayId, SpecialtyOverlayDefinition>>;
}

export interface ProfileRegistryActivation {
  unitProfiles: readonly UnitProfileId[];
  specialtyOverlays: readonly SpecialtyOverlayId[];
}

export interface ProfileContext {
  coreProfileId: HandoverCoreProfileId;
  unitId?: string;
  specialtyId?: string;
  catalogUnitProfileId: UnitProfileId | null;
  unitProfileId: UnitProfileId | null;
  catalogSpecialtyOverlayIds: readonly SpecialtyOverlayId[];
  specialtyOverlayIds: readonly SpecialtyOverlayId[];
  activeProfileIds: readonly ProfileSelectorId[];
  usesCoreFallback: boolean;
  prioritySignals: readonly ContextualPrioritySignal[];
  iceaContext: Readonly<Partial<IceaContextVector>>;
}

export interface ProfileContextInput {
  unitId?: string | null;
  specialtyId?: string | null;
}

export const isUnitProfileId = (value: unknown): value is UnitProfileId =>
  typeof value === 'string' && UNIT_PROFILE_ID_SET.has(value);

export const isSpecialtyOverlayId = (value: unknown): value is SpecialtyOverlayId =>
  typeof value === 'string' && SPECIALTY_OVERLAY_ID_SET.has(value);

const normalizeLegacyHint = (value?: string | null): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const hasAnyHint = (hints: readonly string[], patterns: readonly string[]): boolean =>
  patterns.some((pattern) => hints.some((hint) => hint.includes(pattern)));

const resolveOncologyLegacyUnitProfile = (
  context?: LegacyUnitProfileResolutionContext,
): UnitProfileId => {
  const hints = [context?.unitId, context?.unitName, context?.specialtyId]
    .map((value) => normalizeLegacyHint(value))
    .filter(Boolean);

  if (hasAnyHint(hints, ONCOLOGY_HOME_CARE_HINTS)) return 'home-care';
  if (hasAnyHint(hints, ONCOLOGY_EMERGENCY_HINTS)) return 'emergency';
  if (hasAnyHint(hints, ONCOLOGY_AMBULATORY_HINTS)) return 'ambulatory';
  if (hasAnyHint(hints, ONCOLOGY_INPATIENT_HINTS)) return 'general-inpatient';

  return LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES.oncology[0];
};

export const expandUnitProfileIdsForActivation = (value: unknown): UnitProfileId[] => {
  if (isUnitProfileId(value)) return [value];
  if (typeof value !== 'string') return [];
  if (value === 'oncology') {
    return [...LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES.oncology];
  }

  const legacy = LEGACY_UNIT_PROFILE_ALIASES[value as LegacyUnitProfileAlias];
  return legacy ? [legacy] : [];
};

export const normalizeUnitProfileId = (
  value: unknown,
  context?: LegacyUnitProfileResolutionContext,
): UnitProfileId | null => {
  if (isUnitProfileId(value)) return value;
  if (typeof value !== 'string') return null;
  if (value === 'oncology') {
    return resolveOncologyLegacyUnitProfile(context);
  }
  return LEGACY_UNIT_PROFILE_ALIASES[value as LegacyUnitProfileAlias] ?? null;
};

export const normalizeSpecialtyOverlayId = (value: unknown): SpecialtyOverlayId | null => {
  if (isSpecialtyOverlayId(value)) return value;
  if (typeof value !== 'string') return null;
  return LEGACY_SPECIALTY_OVERLAY_ALIASES[value as LegacySpecialtyOverlayAlias] ?? null;
};
