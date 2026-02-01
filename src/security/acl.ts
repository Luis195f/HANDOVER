// BEGIN HANDOVER_AUTH
import { AuthSession, UserRole } from './auth-types';

export type GuardRole = UserRole | 'viewer';

const ALLOWED_ROLES: ReadonlySet<GuardRole> = new Set(['nurse', 'supervisor', 'admin', 'viewer']);
const PRIVILEGED_ROLES: ReadonlySet<GuardRole> = new Set(['admin', 'supervisor']);

export type AclErrorReason = 'NO_SESSION' | 'FORBIDDEN_ROLE' | 'FORBIDDEN_UNIT' | 'INVALID_UNIT';

export class AclError extends Error {
  reason: AclErrorReason;

  constructor(reason: AclErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'AclError';
    this.reason = reason;
  }
}

type AccessResult = { ok: true } | { ok: false; reason: AclErrorReason };

type RoleInput = GuardRole | GuardRole[];

function normalizeRoles(roles: RoleInput): GuardRole[] {
  return Array.isArray(roles) ? roles : [roles];
}

function sanitizeSessionRoles(session: AuthSession | null): GuardRole[] {
  if (!session) return [];
  const unique = new Set<GuardRole>();

  for (const role of session.roles ?? []) {
    const normalized = String(role).trim().toLowerCase() as GuardRole;

    if (ALLOWED_ROLES.has(normalized)) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

/**
 * Export “seguro” para inspección y tests (sin exponer nada sensible).
 * No devuelve tokens; solo roles normalizados y filtrados.
 */
export function getSessionRoles(session: AuthSession | null): GuardRole[] {
  return sanitizeSessionRoles(session);
}

function hasPrivilegedRole(roles: GuardRole[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function parseBooleanEnv(name: string): boolean {
  const value = process.env[`EXPO_PUBLIC_${name}`] ?? process.env[name];
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function isBypassEnabled(): boolean {
  return parseBooleanEnv('BYPASS_SCOPE');
}

function isAllowAllUnits(): boolean {
  return parseBooleanEnv('ALLOW_ALL_UNITS');
}

function getAllowedUnits(): string[] {
  const raw = process.env.EXPO_PUBLIC_ALLOWED_UNITS ?? process.env.ALLOWED_UNITS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeUnits(units: string[] | undefined): string[] {
  if (!Array.isArray(units)) return [];
  const unique = new Set<string>();
  for (const unit of units) {
    const normalized = unit?.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function evaluateRole(session: AuthSession | null, roles: RoleInput): AccessResult {
  if (!session) {
    return { ok: false, reason: 'NO_SESSION' };
  }
  if (isBypassEnabled()) {
    return { ok: true };
  }
  const required = normalizeRoles(roles);
  const userRoles = new Set<GuardRole>(sanitizeSessionRoles(session));
  return required.some((role) => userRoles.has(role))
    ? { ok: true }
    : { ok: false, reason: 'FORBIDDEN_ROLE' };
}

export function hasRole(session: AuthSession | null, roles: RoleInput): boolean {
  return evaluateRole(session, roles).ok;
}

/**
 * Alias semántico (útil cuando piensas en “cualquiera de estos roles”).
 * No cambia comportamiento.
 */
export function hasAnyRole(session: AuthSession | null, roles: RoleInput): boolean {
  return hasRole(session, roles);
}

export function ensureRole(session: AuthSession | null, roles: RoleInput): void {
  const result = evaluateRole(session, roles);
  if (!result.ok) {
    throw new AclError(result.reason);
  }
}

function evaluateUnitAccess(session: AuthSession | null, unitId: string): AccessResult {
  if (!session) {
    return { ok: false, reason: 'NO_SESSION' };
  }
  if (isBypassEnabled()) {
    return { ok: true };
  }
  const normalized = unitId?.trim();
  if (!normalized) {
    return { ok: false, reason: 'INVALID_UNIT' };
  }
  const roles = sanitizeSessionRoles(session);
  if (hasPrivilegedRole(roles)) {
    return { ok: true };
  }
  if (isAllowAllUnits()) {
    return { ok: true };
  }
  const allowedUnits = getAllowedUnits();
  if (allowedUnits.length > 0 && !allowedUnits.includes(normalized)) {
    return { ok: false, reason: 'FORBIDDEN_UNIT' };
  }
  const sessionUnits = normalizeUnits(session.units);
  if (sessionUnits.includes(normalized)) {
    return { ok: true };
  }
  return { ok: false, reason: 'FORBIDDEN_UNIT' };
}

export function ensureUnitAccess(session: AuthSession | null, unitId: string): void {
  const result = evaluateUnitAccess(session, unitId);
  if (!result.ok) {
    throw new AclError(result.reason);
  }
}
// END HANDOVER_AUTH
