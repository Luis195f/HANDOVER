import { describe, expect, it } from 'vitest';

import { allowedUnitsFrom, hasUnitAccess, type Session } from '@/src/security/auth';

const baseSession: Session = {
  user: { id: 'nurse-1', roles: ['nurse'], allowedUnits: ['UCI'] },
  units: ['ER'],
};

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

  it('returns units from session and user fields', () => {
    const session: Session = {
      user: { id: 'user', allowedUnits: ['ICU'] },
      units: ['WardA'],
    };
    const allowed = allowedUnitsFrom(session, {});
    expect(Array.from(allowed)).toEqual(expect.arrayContaining(['ICU', 'WardA']));
  });
});

describe('hasUnitAccess', () => {
  it('permite acceso con comodín', () => {
    const session: Session = { ...baseSession, user: { id: 'admin', roles: ['chief'], allowedUnits: ['*'] } };
    const allowed = allowedUnitsFrom(session, { EXPO_PUBLIC_ALLOW_ALL_UNITS: '1' });
    expect(allowed.has('*')).toBe(true);
  });

  it('evalúa acceso contra unidades combinadas', () => {
    expect(hasUnitAccess(baseSession, 'UCI')).toBe(true);
    expect(hasUnitAccess(baseSession, 'ER')).toBe(true);
    expect(hasUnitAccess(baseSession, 'Unknown')).toBe(false);
  });
});
