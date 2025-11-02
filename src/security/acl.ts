import type { User } from '@/src/lib/auth';

export function hasUnitAccess(unitId: string | undefined, user: User | null): boolean {
  if (!unitId || !user) {
    return false;
  }
  if (user.role === 'admin') {
    return true;
  }
  return user.unitIds.includes(unitId);
}

export function requireRole(user: User | null, roles: User['role'][]): boolean {
  return Boolean(user && roles.includes(user.role));
}

export function guardUnit(unitId: string | undefined, user: User | null): void {
  if (!hasUnitAccess(unitId, user)) {
    throw new Error('ACCESS_DENIED_UNIT');
  }
}
