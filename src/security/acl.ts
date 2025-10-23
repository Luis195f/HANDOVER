// src/security/acl.ts
// Control de acceso por unidad (scope) con normalización consistente.
//
// - Normaliza lo que el usuario escribe (ej. "Cardiología") a un slug ("cardiologia").
// - Compara contra user.allowedUnits del getSession() igualmente normalizados.
// - Incluye un bypass de desarrollo si EXPO_PUBLIC_BYPASS_SCOPE=1.
//
// Uso típico en tu handler de guardado:
//   const unitId = normalizeUnitId(values.unitId || values.unitName);
//   if (!hasUnitAccess(unitId)) { Alert.alert('Alert', 'No tienes acceso a esta unidad.'); return; }

import { getSession } from './auth'; // Ajusta la ruta si tu archivo está en otra carpeta
import { toSlug } from '@/src/utils/slug';

// Bypass opcional para desarrollo (ej. en simuladores)
const BYPASS_SCOPE =
  process.env.EXPO_PUBLIC_BYPASS_SCOPE === '1' ||
  process.env.BYPASS_SCOPE === '1';

/** Normaliza un nombre/ID de unidad a slug estable (sin acentos, minúsculas, guiones). */
export function normalizeUnitId(v?: string) {
  return v ? toSlug(v) : undefined;
}

/** Devuelve true si el usuario actual tiene acceso a la unidad indicada (tras normalizar). */
export async function hasUnitAccess(unitInput?: string) {
  const isDev =
    typeof globalThis !== 'undefined' && typeof (globalThis as any).__DEV__ === 'boolean'
      ? Boolean((globalThis as any).__DEV__)
      : process.env.NODE_ENV !== 'production';
  if (BYPASS_SCOPE && isDev) {
    return true;
  }

  if (!unitInput) return false;

  const session = await getSession();
  const unitId = toSlug(unitInput);
  const allowed = (session?.user?.allowedUnits ?? []).map(toSlug);

  return allowed.includes(unitId);
}

/** Helper opcional: lanza error con códigos estándar si no hay acceso. */
export async function assertUnitAccessOrThrow(unitInput?: string) {
  const unitId = normalizeUnitId(unitInput);
  if (!unitId) throw new Error('UNIT_MISSING');
  if (!(await hasUnitAccess(unitId))) throw new Error('UNIT_FORBIDDEN');
  return unitId;
}

/** Traduce errores de assertUnitAccessOrThrow a mensajes de UI. */
export function aclErrorToMessage(err: unknown) {
  if (err instanceof Error) {
    if (err.message === 'UNIT_FORBIDDEN') return 'No tienes acceso a esta unidad.';
    if (err.message === 'UNIT_MISSING') return 'Unidad no especificada.';
  }
  return 'No autorizado.';
}
