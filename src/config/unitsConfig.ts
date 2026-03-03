// BEGIN HANDOVER D4 – MultiUnitConfig

import Constants from 'expo-constants';

import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS, type BedsideChecklistItem } from './bedsideChecklist';
import { isOn } from './flags';

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


type BooleanLike = boolean | number | string | null | undefined;

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

export interface HandoverUnitConfig {
  id: string;
  name: string;
  specialty: string;
  default?: boolean;
  features?: UnitFeatureFlags;
}

const BASE_FEATURES: UnitFeatureFlags = {
  checklistItems: DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
  showNicCoding: isOn('SHOW_NIC_CODING'),
  showNocOutcomes: isOn('SHOW_NOC_OUTCOMES'),
  showHandoverTimingMetrics: isOn('SHOW_HANDOVER_TIMING_METRICS'),
  hideLegacyFields: isOn('HIDE_LEGACY_FIELDS'),
};

/** Configuración estática por defecto. */
const STATIC_UNITS_CONFIG: HandoverUnitConfig[] = [
  {
    id: 'icu-adulto',
    name: 'UCI Adulto',
    specialty: 'icu',
    default: true,
    features: BASE_FEATURES,
  },
  {
    id: 'oncologia',
    name: 'Oncología',
    specialty: 'onc',
    features: { ...BASE_FEATURES, enableOncoFields: true },
  },
  {
    id: 'pediatria',
    name: 'Pediatría',
    specialty: 'ped',
    features: { ...BASE_FEATURES, enablePediatricScales: true },
  },
] as const;

function normalizeUnitConfig(unit: HandoverUnitConfig): HandoverUnitConfig {
  const unitFeatures = unit.features ?? {};

  return {
    ...unit,
    features: {
      ...BASE_FEATURES,
      ...unitFeatures,
      showNicCoding: parseBooleanLike(unitFeatures.showNicCoding) ?? BASE_FEATURES.showNicCoding,
      showNocOutcomes: parseBooleanLike(unitFeatures.showNocOutcomes) ?? BASE_FEATURES.showNocOutcomes,
      showHandoverTimingMetrics:
        parseBooleanLike(unitFeatures.showHandoverTimingMetrics) ?? BASE_FEATURES.showHandoverTimingMetrics,
      hideLegacyFields: parseBooleanLike(unitFeatures.hideLegacyFields) ?? BASE_FEATURES.hideLegacyFields,
    },
  };
}

/** Intenta obtener la configuración desde una variable de entorno JSON.  */
function resolveUnitsConfig(): HandoverUnitConfig[] {
  // similar a resolveBaseUrl() en env.ts
  const expoVal = Constants.expoConfig?.extra?.HANDOVER_UNITS_JSON;
  const envVal =
    process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON ??
    process.env.HANDOVER_UNITS_JSON;
  const raw = typeof expoVal === 'string' ? expoVal : envVal ?? '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return STATIC_UNITS_CONFIG.map(normalizeUnitConfig);
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((unit) => normalizeUnitConfig(unit as HandoverUnitConfig));
    }
    return STATIC_UNITS_CONFIG.map(normalizeUnitConfig);
  } catch {
    return STATIC_UNITS_CONFIG.map(normalizeUnitConfig);
  }
}

export const resolveUnitFeatureFlags = (unitId?: string | null): UnitFeatureFlags => {
  const base = { ...BASE_FEATURES };
  const normalizedUnitId = typeof unitId === 'string' ? unitId.trim() : '';
  const defaultUnit = UNITS_CONFIG.find((entry) => entry.default) ?? UNITS_CONFIG[0];

  if (!normalizedUnitId) {
    return {
      ...base,
      ...(defaultUnit?.features ?? {}),
    };
  }

  const unit = UNITS_CONFIG.find((entry) => entry.id === normalizedUnitId) ?? defaultUnit;
  return {
    ...base,
    ...(unit?.features ?? {}),
  };
};

/** Exporta la lista final de configuración de unidades */
export const UNITS_CONFIG: HandoverUnitConfig[] = resolveUnitsConfig();

export const getGlobalFeatureDefaults = (): UnitFeatureFlags => ({ ...BASE_FEATURES });

// END HANDOVER D4 – MultiUnitConfig
