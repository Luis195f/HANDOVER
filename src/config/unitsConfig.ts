// BEGIN HANDOVER D4 – MultiUnitConfig

import Constants from 'expo-constants';

import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS, type BedsideChecklistItem } from './bedsideChecklist';

export interface UnitFeatureFlags {
  enablePediatricScales?: boolean;
  enableOncoFields?: boolean;
  enablePsychosocialExtra?: boolean;
  checklistItems?: BedsideChecklistItem[];
  // Puedes añadir más banderas en el futuro
}

export interface HandoverUnitConfig {
  id: string;
  name: string;
  specialty: string;
  default?: boolean;
  features?: UnitFeatureFlags;
}

const BASE_FEATURES: UnitFeatureFlags = {
  checklistItems: DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
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
    return [...STATIC_UNITS_CONFIG];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed as HandoverUnitConfig[];
    }
    return [...STATIC_UNITS_CONFIG];
  } catch {
    return [...STATIC_UNITS_CONFIG];
  }
}

/** Exporta la lista final de configuración de unidades */
export const UNITS_CONFIG: HandoverUnitConfig[] = resolveUnitsConfig();

// END HANDOVER D4 – MultiUnitConfig
