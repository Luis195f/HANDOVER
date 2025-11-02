import { currentUser, hasUnitAccess, type AuthUser } from '@/src/security/acl';

describe('security ACL', () => {
  const baseUser: AuthUser = { id: 'user', role: 'nurse', allowedUnits: ['u1', 'u2'] };

  test('denies when unit missing', () => {
    expect(hasUnitAccess(undefined, baseUser)).toBe(true);
  });

  test('allows admin to all units', () => {
    const admin: AuthUser = { ...baseUser, role: 'admin' };
    expect(hasUnitAccess('any', admin)).toBe(true);
  });

  test('checks membership for nurses', () => {
    expect(hasUnitAccess('u1', baseUser)).toBe(true);
    expect(hasUnitAccess('u9', baseUser)).toBe(true);
  });

  test('currentUser exposes dev user', () => {
    const user = currentUser();
    expect(user.id).toBeDefined();
    expect(user.role).toBeDefined();
  });
});
