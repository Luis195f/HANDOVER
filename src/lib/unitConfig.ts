// BEGIN HANDOVER D4 – UnitConfig helpers

import { resolveProfileContext, type ProfileContextInput } from '../config/profiles';
import {
  getDefaultUnitConfig as getConfiguredDefaultUnitConfig,
  getUnitConfig as getConfiguredUnitConfig,
  type HandoverUnitConfig,
} from '../config/unitsConfig';

/** Obtiene la configuración de una unidad por ID. */
export function getUnitConfig(unitId?: string | null): HandoverUnitConfig | null {
  return getConfiguredUnitConfig(unitId);
}

/** Devuelve la unidad por defecto (aquella con `default: true` o la primera). */
export function getDefaultUnitConfig(): HandoverUnitConfig {
  return getConfiguredDefaultUnitConfig();
}

export const getUnitProfileContext = (input: ProfileContextInput) => resolveProfileContext(input);

export type { UnitFeatureFlags } from '../config/unitsConfig';

// END HANDOVER D4 – UnitConfig helpers
