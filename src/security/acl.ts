import { allowedUnitsFrom, type Session } from '@/src/security/auth';

export function hasUnitAccess(unitId?: string, session?: Session): boolean {
  if (!unitId) return false;
  const allowed = allowedUnitsFrom(session ?? null);
  return allowed.has('*') || allowed.has(unitId);
}

