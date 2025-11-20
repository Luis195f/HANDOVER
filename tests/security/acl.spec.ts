import { describe, expect, it } from 'vitest';

import type { AuthSession } from '@/src/security/auth-types';
import { ensureRole, ensureUnitAccess, hasRole } from '@/src/security/acl';

const baseSession: AuthSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  userId: 'nurse-1',
  fullName: 'Demo Nurse',
  roles: ['nurse'],
  units: ['icu-a', 'med-1'],
};

describe('ACL helpers', () => {
  it('hasRole matches against provided roles', () => {
    expect(hasRole(baseSession, 'nurse')).toBe(true);
    expect(hasRole(baseSession, 'supervisor')).toBe(false);
    expect(hasRole({ ...baseSession, roles: ['supervisor'] }, ['supervisor'])).toBe(true);
  });

  it('ensureRole throws when role is missing', () => {
    expect(() => ensureRole(baseSession, 'supervisor')).toThrowError('FORBIDDEN_ROLE');
    expect(() => ensureRole(null, 'nurse')).toThrowError('NO_SESSION');
  });

  it('ensureUnitAccess validates unit membership and supervisor bypass', () => {
    expect(() => ensureUnitAccess(baseSession, 'icu-a')).not.toThrow();
    expect(() => ensureUnitAccess(baseSession, 'oncology')).toThrowError('FORBIDDEN_UNIT');
    expect(() => ensureUnitAccess({ ...baseSession, roles: ['supervisor'] }, 'oncology')).not.toThrow();
    expect(() => ensureUnitAccess(baseSession, '')).toThrowError('INVALID_UNIT');
  });
});
