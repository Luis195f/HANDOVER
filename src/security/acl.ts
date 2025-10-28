// src/security/acl.ts
//
// RBAC por unidades con bypass seguro para DEV.
// - Si EXPO_PUBLIC_ALLOW_ALL_UNITS=1 => no se bloquea ninguna unidad (demo).
// - En caso contrario, se respeta la lista de unidades permitidas.
//
// Mantiene nombres y firma para no romper imports existentes.

import { toSlug } from "@/src/utils/taxonomy";
import type { Session } from "@/src/security/auth";
import { allowedUnitsFrom } from "@/src/security/auth";

const ALLOW_ALL =
  (process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS ?? "").toString().trim() === "1";

/** ¿El usuario puede acceder a la unidad? (bypass si ALLOW_ALL) */
export function hasUnitAccess(
  unitId?: string | null,
  session?: Partial<Session> | null
): boolean {
  // Sin unidad concreta: no bloquees la UI.
  if (!unitId) return true;

  // Bypass explícito para demo/dev.
  if (ALLOW_ALL) return true;

  // RBAC real: normaliza y compara contra las unidades permitidas.
  const normalized = toSlug(unitId);
  const allowed = allowedUnitsFrom(session);
  return allowed.has(normalized);
}

/** Variante que devuelve la unidad si es válida; si no, null (útil en guardas). */
export function ensureUnit<T extends string | null | undefined>(
  unitId: T,
  session?: Partial<Session> | null
): T | null {
  if (unitId && hasUnitAccess(unitId, session)) return unitId;
  return null;
}

/** Alias histórico por si en algún lugar se usaba este nombre. */
export const canAccessUnit = hasUnitAccess;

