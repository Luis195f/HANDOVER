// BEGIN HANDOVER_AUTH
import { AuthSession, UserRole } from './auth-types';

export type GuardRole = UserRole | 'viewer';

/**
 * Permisos finos (scopes/permissions).
 * Ej: "handover:read", "handover:write", "patients:read", "patients:write"
 */
export type GuardPermission = string;

const ALLOWED_ROLES: ReadonlySet<GuardRole> = new Set(['nurse', 'supervisor', 'admin', 'viewer']);
const PRIVILEGED_ROLES: ReadonlySet<GuardRole> = new Set(['admin', 'supervisor']);

export type AclErrorReason =
  | 'NO_SESSION'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_PERMISSION'
  | 'FORBIDDEN_UNIT'
  | 'INVALID_UNIT';

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
type PermissionInput = GuardPermission | GuardPermission[];

function normalizeRoles(roles: RoleInput): GuardRole[] {
  return Array.isArray(roles) ? roles : [roles];
}

function normalizePermissions(perms: PermissionInput): GuardPermission[] {
  return Array.isArray(perms) ? perms : [perms];
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

function getAllowedUnits(): string[] {
  const raw = process.env.EXPO_PUBLIC_ALLOWED_UNITS ?? process.env.ALLOWED_UNITS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((value: string) => value.trim())
    .filter((value: string) => value.length > 0);
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

/**
 * Extrae permisos desde una sesión, soportando múltiples formas típicas:
 * - session.permissions: string[] (Auth0 RBAC "Add Permissions in Access Token")
 * - session.scope: "a b c" (OAuth scope clásico)
 * - session.scopes: string[] (si existiese en tu modelo)
 *
 * Importante: NO toca tokens, solo lee strings ya presentes en session.
 */
function sanitizeSessionPermissions(session: AuthSession | null): GuardPermission[] {
  if (!session) return [];
  const unique = new Set<string>();

  // 1) permissions: []
  const permissionsArray = (session as any).permissions;
  if (Array.isArray(permissionsArray)) {
    for (const perm of permissionsArray) {
      const normalized = String(perm).trim();
      if (normalized) unique.add(normalized);
    }
  }

  // 2) scope: "a b c"
  const scopeString = (session as any).scope;
  if (typeof scopeString === 'string' && scopeString.trim().length > 0) {
    for (const perm of scopeString.split(/\s+/g)) {
      const normalized = String(perm).trim();
      if (normalized) unique.add(normalized);
    }
  }

  // 3) scopes: []
  const scopesArray = (session as any).scopes;
  if (Array.isArray(scopesArray)) {
    for (const perm of scopesArray) {
      const normalized = String(perm).trim();
      if (normalized) unique.add(normalized);
    }
  }

  return Array.from(unique);
}

/**
 * Export “seguro” para inspección y tests.
 * No devuelve tokens; solo permissions/scopes normalizados.
 */
export function getSessionPermissions(session: AuthSession | null): GuardPermission[] {
  return sanitizeSessionPermissions(session);
}

function evaluateRole(session: AuthSession | null, roles: RoleInput): AccessResult {
  if (!session) {
    return { ok: false, reason: 'NO_SESSION' };
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

/**
 * ✅ Permisos finos (scopes/permissions)
 * can(session, "handover:write")
 */
export function can(session: AuthSession | null, perms: PermissionInput): boolean {
  if (!session) return false;

  const required = normalizePermissions(perms);
  if (required.length === 0) return true;

  const userPerms = new Set<string>(sanitizeSessionPermissions(session));
  return required.some((p) => userPerms.has(p));
}

/**
 * Lanza AclError si no hay permiso.
 * Nota: no ampliamos AclErrorReason para no romper checks existentes;
 * usamos reason FORBIDDEN_ROLE y message explícito.
 */
export function ensurePermission(session: AuthSession | null, perms: PermissionInput): void {
  if (!session) {
    throw new AclError('NO_SESSION');
  }
  if (!can(session, perms)) {
    throw new AclError('FORBIDDEN_PERMISSION');
  }
}

function evaluateUnitAccess(session: AuthSession | null, unitId: string): AccessResult {
  if (!session) {
    return { ok: false, reason: 'NO_SESSION' };
  }
  const normalized = unitId?.trim();
  if (!normalized) {
    return { ok: false, reason: 'INVALID_UNIT' };
  }
  const roles = sanitizeSessionRoles(session);
  if (hasPrivilegedRole(roles)) {
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

export function hasUnitAccess(session: AuthSession | null, unitId: string): boolean {
  return evaluateUnitAccess(session, unitId).ok;
}
// END HANDOVER_AUTH
