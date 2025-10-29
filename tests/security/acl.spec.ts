import { afterEach, describe, expect, it } from 'vitest';

import { hasUnitAccess } from '@/src/security/acl';
import type { Session } from '@/src/security/auth';

const ORIGINAL_FLAG = process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
  } else {
    process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS = ORIGINAL_FLAG;
  }
});

describe('hasUnitAccess', () => {
  it('allows access when env flag enables wildcard', () => {
    process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS = '1';
    expect(hasUnitAccess('AnyUnit')).toBe(true);
  });

  it('allows access when unit is included in session', () => {
    delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
    const session = { units: ['UCI'] } as Session;
    expect(hasUnitAccess('UCI', session)).toBe(true);
  });

  it('denies access when unit not allowed', () => {
    delete process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS;
    const session = { units: ['UCI'] } as Session;
    expect(hasUnitAccess('XYZ', session)).toBe(false);
  });
});
