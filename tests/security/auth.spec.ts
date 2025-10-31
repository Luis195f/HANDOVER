import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { allowedUnitsFrom, type Session } from '@/src/security/auth';
import { getAuthState, persistAuth, refresh, resetAuthState, type AuthTokens } from '@/src/lib/auth';

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

describe('refresh', () => {
  beforeEach(() => {
    resetAuthState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAuthState();
  });

  it('keeps previous refresh token when refresh response omits it', async () => {
    const previousTokens: AuthTokens = {
      accessToken: 'old-access',
      refreshToken: 'refresh-prev',
      expiresAt: Math.floor(Date.now() / 1000) + 1000,
      scope: 'openid profile email',
    };

    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    await persistAuth(previousTokens, { id: 'nurse-1' });

    vi.setSystemTime(new Date('2025-01-01T01:00:00Z'));
    await refresh({ access_token: 'new-access', expires_in: 7200 }, { id: 'nurse-1' });

    const state = getAuthState();
    expect(state.tokens?.accessToken).toBe('new-access');
    expect(state.tokens?.refreshToken).toBe('refresh-prev');
    expect(state.tokens?.expiresAt).toBe(Math.floor(Date.now() / 1000) + 7200 - 5);
  });
});
