// src/security/acl.ts
//
// RBAC por unidades con bypass seguro para DEV.
// Si EXPO_PUBLIC_ALLOW_ALL_UNITS=1 => se permite toda unidad (demo/local).
// En caso contrario, se respeta RBAC real a partir de la sesión.

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
  if (!unitId) return true;        // sin unidad concreta, no bloquees UI
  if (ALLOW_ALL) return true;      // 🔓 bypass DEV

  // RBAC real
  const normalized = toSlug(unitId);
  const allowed = allowedUnitsFrom(session);
  return allowed.has(normalized);
}

/** Devuelve la unidad si es válida; si no, null (útil en guardas). */
export function ensureUnit<T extends string | null | undefined>(
  unitId: T,
  session?: Partial<Session> | null
): T | null {
  if (unitId && hasUnitAccess(unitId, session)) return unitId;
  return null;
}

/** Alias histórico por compatibilidad si en algún sitio existía este nombre. */
export const canAccessUnit = hasUnitAccess;

