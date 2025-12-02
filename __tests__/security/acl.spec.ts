import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AclError, ensureRole, ensureUnitAccess, hasRole, type GuardRole } from '@/src/security/acl';
import type { AuthSession } from '@/src/security/auth-types';

const originalAllowAll = process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
const originalAllowedUnits = process.env.EXPO_PUBLIC_ALLOWED_UNITS;
const originalBypass = process.env.EXPO_PUBLIC_BYPASS_SCOPE;

const createSession = (roles: GuardRole[], units: string[]): AuthSession => ({
  userId: 'user-1',
  roles,
  units,
  accessToken: 'token',
});

const expectAclError = (fn: () => unknown, reason: string): void => {
  try {
    fn();
    throw new Error('Expected AclError');
  } catch (error) {
    expect(error).toBeInstanceOf(AclError);
    expect((error as AclError).reason).toBe(reason);
  }
};

describe('acl guards', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
    delete process.env.EXPO_PUBLIC_ALLOWED_UNITS;
    delete process.env.EXPO_PUBLIC_BYPASS_SCOPE;
  });

  afterEach(() => {
    if (originalAllowAll === undefined) delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
    else process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS = originalAllowAll;
    if (originalAllowedUnits === undefined) delete process.env.EXPO_PUBLIC_ALLOWED_UNITS;
    else process.env.EXPO_PUBLIC_ALLOWED_UNITS = originalAllowedUnits;
    if (originalBypass === undefined) delete process.env.EXPO_PUBLIC_BYPASS_SCOPE;
    else process.env.EXPO_PUBLIC_BYPASS_SCOPE = originalBypass;
  });

  it('permite rol nurse y rechaza rol desconocido', () => {
    const nurse = createSession(['nurse'], ['Oncología']);
    const unknown = createSession(['test' as GuardRole], ['Oncología']);

    expect(hasRole(nurse, 'nurse')).toBe(true);
    expectAclError(() => ensureRole(unknown, 'nurse'), 'FORBIDDEN_ROLE');
  });

  it('trata admin y supervisor como privilegiados para unidades', () => {
    const admin = createSession(['admin'], []);
    const supervisor = createSession(['supervisor'], []);

    expect(() => ensureUnitAccess(admin, 'Trauma')).not.toThrow();
    expect(() => ensureUnitAccess(supervisor, 'Trauma')).not.toThrow();
  });

  it('bypass scope omite filtros de rol y unidad', () => {
    process.env.EXPO_PUBLIC_BYPASS_SCOPE = 'true';
    const viewer = createSession(['viewer'], []);

    expect(() => ensureRole(viewer, 'nurse')).not.toThrow();
    expect(() => ensureUnitAccess(viewer, 'UCI')).not.toThrow();
  });

  it('allow all units habilita acceso independientemente de las unidades del usuario', () => {
    process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS = 'true';
    const viewer = createSession(['viewer'], ['UCI']);

    expect(() => ensureUnitAccess(viewer, 'Cardiología')).not.toThrow();
  });

  it('filtra por lista de unidades permitidas y por unidades del usuario', () => {
    process.env.EXPO_PUBLIC_ALLOWED_UNITS = 'Oncología,UCI';
    const nurse = createSession(['nurse'], ['Oncología']);

    expect(() => ensureUnitAccess(nurse, 'Oncología')).not.toThrow();
    expectAclError(() => ensureUnitAccess(nurse, 'Trauma'), 'FORBIDDEN_UNIT');
  });

  it('lanza NO_SESSION o INVALID_UNIT en casos límite', () => {
    expectAclError(() => ensureRole(null, 'nurse'), 'NO_SESSION');
    expectAclError(() => ensureUnitAccess(createSession(['nurse'], ['UCI']), '   '), 'INVALID_UNIT');
  });
});
