import { describe, expect, it } from 'vitest';

import { hasUnitAccess } from '@/src/security/acl';
import type { User } from '@/src/lib/auth';

function createUser(overrides: Partial<User> = {}): User {
  return {
    sub: 'nurse-1',
    role: 'nurse',
    unitIds: ['UCI'],
    ...overrides,
  };
}

describe('hasUnitAccess', () => {
  it('returns false when user is missing', () => {
    expect(hasUnitAccess('UCI', null)).toBe(false);
  });

  it('allows access when user is admin regardless of unit list', () => {
    const admin = createUser({ role: 'admin', unitIds: [] });
    expect(hasUnitAccess('AnyUnit', admin)).toBe(true);
  });

  it('allows access when unit is included in user unitIds', () => {
    const nurse = createUser({ unitIds: ['UCI', 'Pab1'] });
    expect(hasUnitAccess('Pab1', nurse)).toBe(true);
  });

  it('denies access when unit not allowed', () => {
    const nurse = createUser({ unitIds: ['UCI'] });
    expect(hasUnitAccess('XYZ', nurse)).toBe(false);
  });
});
