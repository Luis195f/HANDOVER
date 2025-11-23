// BEGIN HANDOVER D4 – UnitConfig helpers

import { UNITS_CONFIG, type HandoverUnitConfig } from '../config/unitsConfig';

/** Obtiene la configuración de una unidad por ID. */
export function getUnitConfig(unitId?: string | null): HandoverUnitConfig | null {
  if (!unitId) return null;
  return UNITS_CONFIG.find((u) => u.id === unitId) ?? null;
}

/** Devuelve la unidad por defecto (aquella con `default: true` o la primera). */
export function getDefaultUnitConfig(): HandoverUnitConfig {
  const found = UNITS_CONFIG.find((u) => u.default);
  return found ?? UNITS_CONFIG[0];
}

export type { UnitFeatureFlags } from '../config/unitsConfig';

// END HANDOVER D4 – UnitConfig helpers
