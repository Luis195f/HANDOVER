// src/security/acl.ts
import { allowedUnitsFrom, type Session } from '@/src/security/auth';
import { toSlug } from '@/src/utils/taxonomy';

const ALLOW_ALL = process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS === '1';

/**
 * Devuelve true si el usuario puede acceder a la unidad.
 * - Si EXPO_PUBLIC_ALLOW_ALL_UNITS=1 -> siempre permite (bypass para DEV).
 * - Si no, usa tu RBAC real vía allowedUnitsFrom(session).
 * Puedes pasar una sesión si ya la tienes; si no, intenta con una cache global opcional.
 */
export function hasUnitAccess(unitId?: string, session?: Partial<Session> | null): boolean {
  if (!unitId) return true;
  if (ALLOW_ALL) return true;

  try {
    const s = session ?? (globalThis as any).__NURSEOS_SESSION_CACHE ?? null;
    const allowed = allowedUnitsFrom((s ?? null) as Session | null);
    return allowed.has(toSlug(unitId));
  } catch {
    // En duda, niega acceso (comportamiento conservador). Si quieres no bloquear en dev, retorna true.
    return false;
  }
}

