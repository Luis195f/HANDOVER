// BEGIN HANDOVER D4 – MultiUnitConfig

import Constants from 'expo-constants';

import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS, type BedsideChecklistItem } from './bedsideChecklist';
import { isOn } from './flags';
import { resolvePilotFeatureState } from './pilotControl';
import {
  normalizeSpecialtyOverlayId,
  normalizeUnitProfileId,
  type SpecialtyOverlayId,
  type UnitProfileId,
} from '../types/profile';

export interface UnitFeatureFlags {
  enablePediatricScales?: boolean;
  enableOncoFields?: boolean;
  enablePsychosocialExtra?: boolean;
  checklistItems?: BedsideChecklistItem[];
  showNicCoding?: boolean;
  showNocOutcomes?: boolean;
  showHandoverTimingMetrics?: boolean;
  hideLegacyFields?: boolean;
  // Puedes añadir más banderas en el futuro
}

export interface HandoverUnitConfig {
  id: string;
  name: string;
  specialty: string;
  default?: boolean;
  features?: UnitFeatureFlags;
  profileId?: UnitProfileId;
  specialtyOverlayIds?: SpecialtyOverlayId[];
}

interface UnitFeatureContext {
  roles?: string[] | null;
}

type BooleanLike = boolean | number | string | null | undefined;
type LegacyHandoverUnitConfig = HandoverUnitConfig & {
  isPediatric?: BooleanLike;
};

const parseBooleanLike = (value: BooleanLike): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
};

const normalizeOverlayIds = (value: unknown): SpecialtyOverlayId[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => normalizeSpecialtyOverlayId(entry))
    .filter((entry): entry is SpecialtyOverlayId => Boolean(entry));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
};

const BASE_FEATURES: UnitFeatureFlags = {
  checklistItems: DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
  showNicCoding: isOn('SHOW_NIC_CODING'),
  showNocOutcomes: isOn('SHOW_NOC_OUTCOMES'),
  showHandoverTimingMetrics: isOn('SHOW_HANDOVER_TIMING_METRICS'),
  hideLegacyFields: isOn('HIDE_LEGACY_FIELDS'),
};

const BEHAVIORAL_HEALTH_CHILD_CHECKLIST_ITEMS: readonly BedsideChecklistItem[] = [
  {
    key: 'patientIdentityConfirmed',
    label: 'Paciente, ubicacion funcional y referente interno confirmados',
    helper: 'Prioriza censo/listado, ubicacion y quien centraliza la comunicacion del turno.',
  },
  {
    key: 'allergiesReviewed',
    label: 'Observacion especial, acompanamiento y entorno seguro revisados',
    helper: 'Asegura continuidad del acompanamiento, cambios respecto al basal y avisos internos del turno.',
  },
  {
    key: 'linesAndDevicesChecked',
    label: 'Pertenencias, dispositivos retirables y riesgo de fuga/no retorno revisados',
    helper: 'Deja visible solo lo necesario para continuidad, retorno seguro y coordinacion del relevo.',
  },
  {
    key: 'medicationPlanReviewed',
    label: 'Adherencia, medicacion pendiente y actividad terapeutica revisadas',
    helper: 'Incluye rechazos, acompanamiento y continuidad generica del plan del turno.',
  },
  {
    key: 'safetyMeasuresApplied',
    label: 'Coordinacion interna y con familia o tutor cuando aplique revisadas',
    helper: 'Registra continuidad de comunicacion solo como coordinacion del relevo y siguiente reevaluacion.',
  },
  {
    key: 'questionsAnswered',
    label: 'Preguntas del equipo entrante resueltas',
    helper: 'Aclara acompanamiento, continuidad y coordinaciones del siguiente turno.',
  },
];

const BEHAVIORAL_HEALTH_PSYCHOGERIATRICS_CHECKLIST_ITEMS: readonly BedsideChecklistItem[] = [
  {
    key: 'patientIdentityConfirmed',
    label: 'Paciente, ubicacion funcional, basal cognitivo-funcional y supervision requerida confirmados',
    helper: 'Prioriza censo/listado, ubicacion y referencia breve del estado habitual y del apoyo necesario.',
  },
  {
    key: 'allergiesReviewed',
    label: 'Cambio respecto al basal, deambulacion supervisada y riesgo de caidas revisados',
    helper: 'Haz visible deterioro cognitivo-funcional, movilidad y ayudas necesarias del turno.',
  },
  {
    key: 'linesAndDevicesChecked',
    label: 'Entorno seguro, continencia, piel y elementos retirables verificados',
    helper: 'Confirma dispositivos o tratamientos que pueda retirarse y cualquier continuidad de continencia o integridad cutanea.',
  },
  {
    key: 'medicationPlanReviewed',
    label: 'Ingesta, hidratacion, sueno y adherencia terapeutica revisados',
    helper: 'Incluye medicacion pendiente, rechazos o dificultad para sostener el plan del siguiente turno.',
  },
  {
    key: 'safetyMeasuresApplied',
    label: 'Supervision, coordinacion interna y con cuidadores, y reevaluacion revisadas',
    helper: 'Aclara acompanamiento, comunicacion o relacion relevante, actividad estructurada cuando aplique y continuidad del relevo siguiente.',
  },
  {
    key: 'questionsAnswered',
    label: 'Preguntas del equipo entrante resueltas',
    helper: 'Resume continuidad funcional, cognitiva y pendientes del relevo siguiente.',
  },
];

/** Configuración estática por defecto. */
const STATIC_UNITS_CONFIG: HandoverUnitConfig[] = [
  {
    id: 'icu-adulto',
    name: 'UCI Adulto',
    specialty: 'icu',
    default: true,
    profileId: 'critical-care',
    features: BASE_FEATURES,
  },
  {
    id: 'oncologia',
    name: 'Oncología',
    specialty: 'onc',
    profileId: 'ambulatory',
    specialtyOverlayIds: ['onc'],
    features: { ...BASE_FEATURES, enableOncoFields: true },
  },
  {
    id: 'pediatria',
    name: 'Pediatría',
    specialty: 'ped',
    profileId: 'general-inpatient',
    specialtyOverlayIds: ['pedsSubspecialties'],
    features: { ...BASE_FEATURES, enablePediatricScales: true },
  },
  {
    id: 'sjd-a',
    name: 'Unidad de Salud Mental Adultos A',
    specialty: 'psych',
    profileId: 'behavioral-health',
    features: { ...BASE_FEATURES, enablePsychosocialExtra: true },
  },
  {
    id: 'sjd-b',
    name: 'Unidad de Salud Mental Adultos B',
    specialty: 'psych',
    profileId: 'behavioral-health',
    features: { ...BASE_FEATURES, enablePsychosocialExtra: true },
  },
  {
    id: 'sjd-infanto',
    name: 'Unidad de Salud Mental Infanto-Adolescente',
    specialty: 'psych',
    profileId: 'behavioral-health',
    features: {
      ...BASE_FEATURES,
      enablePsychosocialExtra: true,
      checklistItems: [...BEHAVIORAL_HEALTH_CHILD_CHECKLIST_ITEMS],
    },
  },
  {
    id: 'udcc-psychogeriatrics',
    name: 'Unidad de Psicogeriatria',
    specialty: 'psych',
    profileId: 'behavioral-health',
    features: {
      ...BASE_FEATURES,
      enablePsychosocialExtra: true,
      checklistItems: [...BEHAVIORAL_HEALTH_PSYCHOGERIATRICS_CHECKLIST_ITEMS],
    },
  },
] as const;

const STATIC_UNITS_CONFIG_BY_ID = STATIC_UNITS_CONFIG.reduce(
  (acc, unit) => ({ ...acc, [unit.id]: unit }),
  {} as Record<string, HandoverUnitConfig>
);

const getStaticUnitsConfig = (): HandoverUnitConfig[] => STATIC_UNITS_CONFIG.map((unit) => normalizeUnitConfig(unit));

const getStaticUnitFallback = (unitId?: string): HandoverUnitConfig | undefined => {
  if (!unitId) return undefined;
  return STATIC_UNITS_CONFIG_BY_ID[unitId];
};

function normalizeUnitConfig(unit: LegacyHandoverUnitConfig, defaultUnitId?: string): HandoverUnitConfig {
  const fallbackUnit = getStaticUnitFallback(unit.id);
  const unitFeatures = unit.features ?? {};
  const fallbackFeatures = fallbackUnit?.features ?? {};
  const legacyPediatricFlag = parseBooleanLike(unit.isPediatric);
  const specialty =
    (typeof unit.specialty === 'string' && unit.specialty.trim()) ||
    fallbackUnit?.specialty ||
    (legacyPediatricFlag ? 'ped' : 'icu');
  const normalizedProfileId =
    normalizeUnitProfileId(unit.profileId, {
      unitId: unit.id,
      unitName: unit.name,
      specialtyId: specialty,
    }) ??
    fallbackUnit?.profileId ??
    (legacyPediatricFlag ? 'general-inpatient' : undefined) ??
    (specialty === 'icu' ? 'critical-care' : specialty === 'ped' ? 'general-inpatient' : undefined);
  const specialtyOverlayIds =
    normalizeOverlayIds(unit.specialtyOverlayIds) ??
    fallbackUnit?.specialtyOverlayIds ??
    (legacyPediatricFlag ? ['pedsSubspecialties'] : undefined);
  const normalizedDefault =
    parseBooleanLike(unit.default) ??
    (typeof defaultUnitId === 'string' && defaultUnitId.trim() ? unit.id === defaultUnitId.trim() : undefined) ??
    fallbackUnit?.default;

  return {
    ...unit,
    specialty,
    default: normalizedDefault,
    profileId: normalizedProfileId,
    specialtyOverlayIds,
    features: {
      ...BASE_FEATURES,
      ...fallbackFeatures,
      ...unitFeatures,
      enablePediatricScales:
        parseBooleanLike(unitFeatures.enablePediatricScales) ??
        fallbackFeatures.enablePediatricScales ??
        legacyPediatricFlag,
      enableOncoFields:
        parseBooleanLike(unitFeatures.enableOncoFields) ??
        fallbackFeatures.enableOncoFields,
      enablePsychosocialExtra:
        parseBooleanLike(unitFeatures.enablePsychosocialExtra) ??
        fallbackFeatures.enablePsychosocialExtra,
      checklistItems:
        Array.isArray(unitFeatures.checklistItems) ? unitFeatures.checklistItems : fallbackFeatures.checklistItems,
      showNicCoding:
        parseBooleanLike(unitFeatures.showNicCoding) ??
        fallbackFeatures.showNicCoding ??
        BASE_FEATURES.showNicCoding,
      showNocOutcomes:
        parseBooleanLike(unitFeatures.showNocOutcomes) ??
        fallbackFeatures.showNocOutcomes ??
        BASE_FEATURES.showNocOutcomes,
      showHandoverTimingMetrics:
        parseBooleanLike(unitFeatures.showHandoverTimingMetrics) ??
        fallbackFeatures.showHandoverTimingMetrics ??
        BASE_FEATURES.showHandoverTimingMetrics,
      hideLegacyFields:
        parseBooleanLike(unitFeatures.hideLegacyFields) ??
        fallbackFeatures.hideLegacyFields ??
        BASE_FEATURES.hideLegacyFields,
    },
  };
}

/** Intenta obtener la configuración desde una variable de entorno JSON.  */
function resolveUnitsConfig(): HandoverUnitConfig[] {
  const expoVal = Constants.expoConfig?.extra?.HANDOVER_UNITS_JSON;
  const envVal =
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON ??
    process.env.HANDOVER_UNITS_JSON ??
    process.env.UNITS_CONFIG;
  const raw = typeof expoVal === 'string' ? expoVal : envVal ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return getStaticUnitsConfig();
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const normalized = parsed.map((unit) => normalizeUnitConfig(unit as LegacyHandoverUnitConfig));
      return normalized.length > 0 ? normalized : getStaticUnitsConfig();
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { units?: unknown }).units)) {
      const defaultUnitId =
        typeof (parsed as { defaultUnit?: unknown }).defaultUnit === 'string'
          ? (parsed as { defaultUnit: string }).defaultUnit
          : undefined;
      const normalized = (parsed as { units: LegacyHandoverUnitConfig[] }).units.map((unit) =>
        normalizeUnitConfig(unit, defaultUnitId),
      );
      return normalized.length > 0 ? normalized : getStaticUnitsConfig();
    }
    return getStaticUnitsConfig();
  } catch {
    return getStaticUnitsConfig();
  }
}

export const resolveUnitFeatureFlags = (
  unitId?: string | null,
  context: UnitFeatureContext = {},
): UnitFeatureFlags => {
  const base = { ...BASE_FEATURES };
  const normalizedUnitId = typeof unitId === 'string' ? unitId.trim() : '';
  const defaultUnit = UNITS_CONFIG.find((entry) => entry.default) ?? UNITS_CONFIG[0];
  const effectiveUnitId = normalizedUnitId || defaultUnit?.id || '';

  const unit = normalizedUnitId ? UNITS_CONFIG.find((entry) => entry.id === normalizedUnitId) ?? defaultUnit : defaultUnit;
  const resolved = {
    ...base,
    ...(unit?.features ?? {}),
  };
  const governedNnnState = resolvePilotFeatureState('governed_nnn', {
    unitId: effectiveUnitId,
    roles: context.roles ?? [],
  });
  const governedNnnEnabled =
    governedNnnState.enabled ||
    (governedNnnState.denialReason === 'kill_switch_disabled' &&
      (Boolean(resolved.showNicCoding) || Boolean(resolved.showNocOutcomes)));
  return {
    ...resolved,
    showNicCoding: Boolean(resolved.showNicCoding) && governedNnnEnabled,
    showNocOutcomes: Boolean(resolved.showNocOutcomes) && governedNnnEnabled,
  };
};

/** Exporta la lista final de configuración de unidades */
export const UNITS_CONFIG: HandoverUnitConfig[] = resolveUnitsConfig();

export const getGlobalFeatureDefaults = (): UnitFeatureFlags => ({ ...BASE_FEATURES });

const findDefaultUnit = (units: readonly HandoverUnitConfig[]): HandoverUnitConfig => {
  const flaggedDefault = units.find((entry) => entry.default);
  if (flaggedDefault) return flaggedDefault;
  const legacyDefault = units.find((entry) => entry.id === 'uci-adulto');
  return legacyDefault ?? units[0];
};

export function getUnitConfig(unitId?: string | null): HandoverUnitConfig | null;
export function getUnitConfig(units: readonly HandoverUnitConfig[], unitId?: string | null): HandoverUnitConfig | null;
export function getUnitConfig(
  unitsOrUnitId?: readonly HandoverUnitConfig[] | string | null,
  unitId?: string | null,
): HandoverUnitConfig | null {
  if (Array.isArray(unitsOrUnitId)) {
    const units = unitsOrUnitId;
    if (units.length === 0) return null;
    const normalizedUnitId = typeof unitId === 'string' ? unitId.trim() : '';
    return units.find((entry) => entry.id === normalizedUnitId) ?? findDefaultUnit(units) ?? null;
  }

  const normalizedUnitId = typeof unitsOrUnitId === 'string' ? unitsOrUnitId.trim() : '';
  if (!normalizedUnitId) return null;
  return UNITS_CONFIG.find((entry) => entry.id === normalizedUnitId) ?? null;
}

export function getDefaultUnitConfig(): HandoverUnitConfig;
export function getDefaultUnitConfig(units: readonly HandoverUnitConfig[]): HandoverUnitConfig;
export function getDefaultUnitConfig(units?: readonly HandoverUnitConfig[]): HandoverUnitConfig {
  const source = Array.isArray(units) && units.length > 0 ? units : UNITS_CONFIG;
  return findDefaultUnit(source);
}

// END HANDOVER D4 – MultiUnitConfig
