import { AclError, ensureUnitAccess, hasRole } from '@/src/security/acl';
import type { AuthSession } from '@/src/security/auth-types';

describe('security ACL', () => {
  const baseSession: AuthSession = {
    userId: 'user',
    accessToken: 'token',
    roles: ['nurse'],
    units: ['u1', 'u2'],
  };

  test('denies when unit missing', () => {
    expect(() => ensureUnitAccess(baseSession, '')).toThrow(AclError);
  });

  test('allows admin to all units', () => {
    const admin: AuthSession = { ...baseSession, roles: ['admin'] };
    expect(() => ensureUnitAccess(admin, 'any')).not.toThrow();
  });

  test('checks membership for nurses', () => {
    expect(() => ensureUnitAccess(baseSession, 'u1')).not.toThrow();
    expect(() => ensureUnitAccess(baseSession, 'u9')).toThrow(AclError);
  });

  test('hasRole validates session roles', () => {
    expect(hasRole(baseSession, 'nurse')).toBe(true);
    expect(hasRole(baseSession, 'admin')).toBe(false);
  });
});
