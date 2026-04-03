import { describe, expect, it, afterEach } from 'vitest';

import { hasRole, can } from '@/src/security/acl';
import type { AuthSession } from '@/src/security/auth-types';

const nurseSession: AuthSession = {
  userId: 'nurse-1',
  accessToken: 'token',
  roles: ['nurse'],
  units: ['UCI'],
};

describe('ACL bypass scope in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypass = process.env.BYPASS_SCOPE;
  const originalPublicBypass = process.env.EXPO_PUBLIC_BYPASS_SCOPE;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.BYPASS_SCOPE = originalBypass;
    process.env.EXPO_PUBLIC_BYPASS_SCOPE = originalPublicBypass;
  });

  it('ignora BYPASS_SCOPE en production', () => {
    process.env.NODE_ENV = 'production';
    process.env.BYPASS_SCOPE = 'true';

    expect(hasRole(nurseSession, 'admin')).toBe(false);
    expect(can(nurseSession, 'handover:audit')).toBe(false);
  });


  it('ignora EXPO_PUBLIC_BYPASS_SCOPE incluso fuera de production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.BYPASS_SCOPE;
    process.env.EXPO_PUBLIC_BYPASS_SCOPE = 'true';

    expect(hasRole(nurseSession, 'admin')).toBe(false);
    expect(can(nurseSession, 'handover:audit')).toBe(false);
  });

  it('no permite bypass fuera de production', () => {
    process.env.NODE_ENV = 'development';
    process.env.BYPASS_SCOPE = 'true';

    expect(hasRole(nurseSession, 'admin')).toBe(false);
    expect(can(nurseSession, 'handover:audit')).toBe(false);
  });
});
