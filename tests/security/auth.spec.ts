import { describe, expect, it } from 'vitest';

import { allowedUnitsFrom, type Session } from '@/src/security/auth';

describe('allowedUnitsFrom', () => {
  it('returns empty set when session is null', () => {
    const allowed = allowedUnitsFrom(null, {});
    expect(allowed.size).toBe(0);
  });

  it('returns wildcard when env flag is enabled', () => {
    const allowed = allowedUnitsFrom(null, { EXPO_PUBLIC_ALLOW_ALL_UNITS: '1' });
    expect(allowed.has('*')).toBe(true);
    expect(allowed.size).toBe(1);
  });

  it('returns units from session', () => {
    const session = { units: ['UCI', 'Pab1'] } as Session;
    const allowed = allowedUnitsFrom(session, {});
    expect(allowed.has('UCI')).toBe(true);
    expect(allowed.has('XYZ')).toBe(false);
  });
});
