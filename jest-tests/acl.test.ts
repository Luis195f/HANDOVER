import { hasUnitAccess, requireRole } from '@/src/security/acl';
import type { User } from '@/src/lib/auth';

describe('security ACL', () => {
  const baseUser: User = { sub: 'user', role: 'nurse', unitIds: ['u1', 'u2'], name: 'Nurse' };

  test('denies when unit missing', () => {
    expect(hasUnitAccess(undefined, baseUser)).toBe(false);
  });

  test('allows admin to all units', () => {
    const admin: User = { ...baseUser, role: 'admin' };
    expect(hasUnitAccess('any', admin)).toBe(true);
  });

  test('checks membership for nurses', () => {
    expect(hasUnitAccess('u1', baseUser)).toBe(true);
    expect(hasUnitAccess('u9', baseUser)).toBe(false);
  });

  test('requireRole validates membership', () => {
    expect(requireRole(baseUser, ['nurse'])).toBe(true);
    expect(requireRole(baseUser, ['admin'])).toBe(false);
  });

  test('requireRole handles null user', () => {
    expect(requireRole(null, ['viewer'])).toBe(false);
  });
});
