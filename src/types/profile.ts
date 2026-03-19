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
  'cardio',
  'neuro',
  'onc',
  'trauma',
  'infecto',
  'neumo',
  'nefroUro',
  'gastroHepato',
  'endo',
  'gynObs',
  'pedsSubspecialties',
  'ophthalEnt',
  'plasticsBurns',
  'criticalEmergency',
  'transplant',
] as const;

export const LEGACY_UNIT_PROFILE_ALIASES = {
  pediatrics: 'general-inpatient',
} as const;

export const LEGACY_CONTEXTUAL_UNIT_PROFILE_ALIASES = {
  oncology: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
} as const;

export const LEGACY_SPECIALTY_OVERLAY_ALIASES = {
  cvicu: 'cardio',
  neuroicu: 'neuro',
  neph: 'nefroUro',
  gastro: 'gastroHepato',
  pulm: 'neumo',
  infect: 'infecto',
  ped: 'pedsSubspecialties',
  ob: 'gynObs',
  ent: 'ophthalEnt',
  burns: 'plasticsBurns',
  'critical-emergency': 'criticalEmergency',
  gyn: 'gynObs',
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
export type ProfileCatalogReadiness = 'wave-1' | 'registry-only' | 'scaffold';
export const HANDOVER_SECTION_KEYS = [
  'turno',
  'paciente',
  'sbar',
  'signos',
  'oxigenoterapia',
  'dispositivos',
  'seguridad',
  'alertas',
  'nutrition',
  'elimination',
  'fluidBalance',
  'mobilitySkin',
  'psychosocial',
  'escalas',
  'examenes',
  'medicacion',
  'adjuntos',
  'diagnosticos',
  'outcomes',
  'evolucion',
  'resumen',
  'bedsideChecklist',
  'firmas',
] as const;
export type HandoverSectionKey = (typeof HANDOVER_SECTION_KEYS)[number];
export const PROFILE_RUNTIME_FIELD_IDS = [
  'legacy-sbar-narrative',
  'legacy-medication-text',
  'legacy-nursing-diagnosis-text',
  'nic-coding-hint',
  'handover-timing-hint',
  'noc-outcomes',
] as const;
export type ProfileRuntimeFieldId = (typeof PROFILE_RUNTIME_FIELD_IDS)[number];

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

export type IceaContextPlaceholderKey = Exclude<keyof IceaContextVector, 'caseMixHints'>;

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
  iceaContextPlaceholders?: readonly IceaContextPlaceholderKey[];
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
  requestedSpecialtyId?: string;
  specialtyId?: string;
  specialtySource: 'explicit' | 'unit' | 'unit-config' | 'none';
  catalogUnitProfileId: UnitProfileId | null;
  unitProfileId: UnitProfileId | null;
  overlaySelections: readonly ProfileOverlaySelection[];
  catalogSpecialtyOverlayIds: readonly SpecialtyOverlayId[];
  specialtyOverlayIds: readonly SpecialtyOverlayId[];
  activeProfileIds: readonly ProfileSelectorId[];
  hasHumanSpecialtyOverride: boolean;
  usesCoreFallback: boolean;
  prioritySignals: readonly ContextualPrioritySignal[];
  iceaContext: Readonly<Partial<IceaContextVector>>;
}

export interface ProfileContextInput {
  unitId?: string | null;
  specialtyId?: string | null;
}

export interface ProfileRuntimeMedicationQuickPick {
  id: string;
  name: string;
  code?: {
    system: string;
    code: string;
    display?: string;
  };
}

export interface ProfileRuntimeTreatmentQuickPick {
  id: string;
  type: 'woundCare' | 'respiratory' | 'mobilization' | 'education' | 'other';
  description: string;
  code?: {
    system: 'NIC';
    code: string;
    display: string;
  };
}

export interface ProfileOverlaySelection {
  overlayId: SpecialtyOverlayId;
  source: 'unit-config' | 'specialty';
  specialtyId?: string;
  isHumanOverride: boolean;
}

interface ProfileRuntimePackShape {
  label: string;
  enabledSections?: readonly HandoverSectionKey[];
  hiddenSections?: readonly HandoverSectionKey[];
  requiredExtraFields?: readonly string[];
  optionalExtraFields?: readonly string[];
  focusAreas?: readonly string[];
  explanations?: readonly string[];
  scales?: readonly string[];
  sentinelEvents?: readonly string[];
  visibility?: Readonly<Partial<Record<ProfileRuntimeFieldId, boolean>>>;
  quickPicks?: Readonly<{
    medications?: readonly ProfileRuntimeMedicationQuickPick[];
    treatments?: readonly ProfileRuntimeTreatmentQuickPick[];
  }>;
  visibleOutputs?: readonly string[];
  notes?: readonly string[];
}

export type ProfileRuntimeLayerSource = 'core' | 'unit-profile' | 'specialty-overlay';

export type ProfileRuntimeMergeKey =
  | 'enabledSections'
  | 'hiddenSections'
  | 'requiredExtraFields'
  | 'optionalExtraFields'
  | 'focusAreas'
  | 'explanations'
  | 'scales'
  | 'sentinelEvents'
  | 'visibility'
  | 'quickPicks'
  | 'visibleOutputs'
  | 'notes';

export type ProfileRuntimeExtensionMode = 'additive' | 'sticky-hidden' | 'guarded-visibility';

export interface ProfileRuntimeExtensionPoint {
  mode: ProfileRuntimeExtensionMode;
  allowedSources: readonly Exclude<ProfileRuntimeLayerSource, 'core'>[];
  description: string;
}

export const PROFILE_RUNTIME_EXTENSION_POINTS: Readonly<
  Record<ProfileRuntimeMergeKey, ProfileRuntimeExtensionPoint>
> = {
  enabledSections: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Amplia secciones visibles sin abrir formularios paralelos.',
  },
  hiddenSections: {
    mode: 'sticky-hidden',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Solo reduce visibilidad; una seccion ya ocultada no debe reabrirse por omision.',
  },
  requiredExtraFields: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade campos clinicos obligatorios del contexto resuelto.',
  },
  optionalExtraFields: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade campos opcionales contextuales sin duplicar formularios.',
  },
  focusAreas: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Permite a UPP y overlays reforzar focos clinicos sobre el mismo formulario base.',
  },
  explanations: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Explica por que un UPP u overlay esta activo sin alterar el payload clinico.',
  },
  scales: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade escalas sugeridas compatibles con el perfil base.',
  },
  sentinelEvents: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade eventos centinela esperables para la unidad o subespecialidad.',
  },
  visibility: {
    mode: 'guarded-visibility',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Los UPP afinan visibilidad; los overlays solo pueden estrecharla y no reactivar campos ya cerrados.',
  },
  quickPicks: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade sugerencias contextuales con deduplicacion por id.',
  },
  visibleOutputs: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Declara salidas visibles esperadas del runtime resuelto.',
  },
  notes: {
    mode: 'additive',
    allowedSources: ['unit-profile', 'specialty-overlay'],
    description: 'Anade notas de compatibilidad o rollout del perfil.',
  },
} as const;

export const UNIT_PROFILE_RUNTIME_EXTENSION_KEYS = (
  Object.entries(PROFILE_RUNTIME_EXTENSION_POINTS)
    .filter(([, value]) => value.allowedSources.includes('unit-profile'))
    .map(([key]) => key)
) as ProfileRuntimeMergeKey[];

export const SPECIALTY_OVERLAY_RUNTIME_EXTENSION_KEYS = (
  Object.entries(PROFILE_RUNTIME_EXTENSION_POINTS)
    .filter(([, value]) => value.allowedSources.includes('specialty-overlay'))
    .map(([key]) => key)
) as ProfileRuntimeMergeKey[];

export interface ProfileRuntimeMergeTraceEntry {
  source: ProfileRuntimeLayerSource;
  profileId: ProfileSelectorId;
  label: string;
  additiveKeys: readonly ProfileRuntimeMergeKey[];
  overrideKeys: readonly ProfileRuntimeMergeKey[];
  ignoredKeys?: readonly ProfileRuntimeMergeKey[];
  guardrailNotes?: readonly string[];
}

export interface UnitProfileRuntimePack extends ProfileRuntimePackShape {
  id: HandoverCoreProfileId | UnitProfileId;
}

export interface SpecialtyOverlayRuntimePack extends ProfileRuntimePackShape {
  id: SpecialtyOverlayId;
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

