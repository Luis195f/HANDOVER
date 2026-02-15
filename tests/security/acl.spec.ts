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

describe('ACL env flags and edge cases', () => {
  beforeEach(() => {
    delete process.env.BYPASS_SCOPE;
    delete process.env.ALLOW_ALL_UNITS;
    delete process.env.EXPO_PUBLIC_BYPASS_SCOPE;
    delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
    delete process.env.EXPO_PUBLIC_ALLOWED_UNITS;
  });

  it('fails closed for unknown roles', () => {
    const session: AuthSession = { ...baseSession, roles: ['unknown' as never] };
    expect(hasRole(session, 'viewer')).toBe(false);
    expect(() => ensureRole(session, 'viewer')).toThrowError('FORBIDDEN_ROLE');
  });

  it('returns NO_SESSION when bypass flag is set but session is missing', () => {
    process.env.BYPASS_SCOPE = 'true';
    expect(hasRole(null, 'nurse')).toBe(false);
    expect(() => ensureRole(null, 'nurse')).toThrowError('NO_SESSION');
  });

  it('bypasses unit and role checks when bypass flag is enabled with session', () => {
    process.env.BYPASS_SCOPE = 'true';
    expect(() => ensureRole(baseSession, 'admin')).not.toThrow();
    expect(() => ensureUnitAccess(baseSession, 'any-unit')).not.toThrow();
  });


  it('ignores public bypass env to avoid exposing bypass in client bundle', () => {
    process.env.EXPO_PUBLIC_BYPASS_SCOPE = 'true';
    expect(() => ensureRole(baseSession, 'admin')).toThrowError('FORBIDDEN_ROLE');
  });

  it('allows all units when allow-all flag is set', () => {
    process.env.ALLOW_ALL_UNITS = 'true';
    expect(() => ensureUnitAccess({ ...baseSession, roles: ['nurse'] }, 'new-unit')).not.toThrow();
  });

  it('respects allowed units allow-list', () => {
    process.env.EXPO_PUBLIC_ALLOWED_UNITS = 'icu-a, med-2';
    expect(() => ensureUnitAccess(baseSession, 'icu-a')).not.toThrow();
    expect(() => ensureUnitAccess(baseSession, 'med-2')).toThrowError('FORBIDDEN_UNIT');
  });

  it('requires session for unit access checks', () => {
    expect(() => ensureUnitAccess(null, 'icu-a')).toThrowError('NO_SESSION');
  });
});
