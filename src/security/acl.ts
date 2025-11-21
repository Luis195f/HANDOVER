// BEGIN HANDOVER_AUTH
import { AuthSession, UserRole } from './auth-types';

const ALLOWED_ROLES: ReadonlySet<UserRole> = new Set(['nurse', 'supervisor', 'admin']);

function normalizeRoles(roles: UserRole | UserRole[]): UserRole[] {
  return Array.isArray(roles) ? roles : [roles];
}

function sanitizeSessionRoles(session: AuthSession | null): UserRole[] {
  if (!session) return [];
  return (session.roles ?? []).filter((role): role is UserRole => ALLOWED_ROLES.has(role as UserRole));
}

export function hasRole(session: AuthSession | null, roles: UserRole | UserRole[]): boolean {
  const required = normalizeRoles(roles);
  const userRoles = new Set<UserRole>(sanitizeSessionRoles(session));
  return required.some((role) => userRoles.has(role));
}

export function ensureRole(session: AuthSession | null, roles: UserRole | UserRole[]): void {
  if (!session) {
    throw new Error('NO_SESSION');
  }
  if (!hasRole(session, roles)) {
    throw new Error('FORBIDDEN_ROLE');
  }
}

export function ensureUnitAccess(session: AuthSession | null, unitId: string): void {
  if (!session) {
    throw new Error('NO_SESSION');
  }
  const normalized = unitId?.trim();
  if (!normalized) {
    throw new Error('INVALID_UNIT');
  }
  if (hasRole(session, ['supervisor', 'admin'])) {
    return;
  }
  if (session.units.includes(normalized)) {
    return;
  }
  throw new Error('FORBIDDEN_UNIT');
}
// END HANDOVER_AUTH
