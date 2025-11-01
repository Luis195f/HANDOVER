import { afterEach, describe, expect, it } from 'vitest';

import {
  getAuthState,
  persistAuth,
  refresh,
  resetAuthState,
  type AuthTokens,
} from '@/src/lib/auth';

describe('auth helpers', () => {
  afterEach(() => {
    resetAuthState();
  });

  it('persistAuth actualiza el estado global', async () => {
    const tokens: AuthTokens = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 123,
    };
    await persistAuth(tokens, { id: 'user-1', name: 'Jane' });

    expect(getAuthState()).toEqual({
      tokens,
      user: { id: 'user-1', name: 'Jane' },
    });
  });

  it('refresh reutiliza refreshToken previo si no viene en respuesta', async () => {
    const tokens: AuthTokens = {
      accessToken: 'initial',
      refreshToken: 'keep-me',
      expiresAt: 0,
    };
    await persistAuth(tokens, { id: 'user-2' });

    const result = await refresh({ access_token: 'next', expires_in: 120 }, { id: 'user-2' });

    expect(result.accessToken).toBe('next');
    expect(result.refreshToken).toBe('keep-me');
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('resetAuthState limpia tokens y usuario', async () => {
    const tokens: AuthTokens = {
      accessToken: 'abc',
      refreshToken: 'def',
      expiresAt: 1000,
    };
    await persistAuth(tokens, { id: 'user-3' });

    resetAuthState();

    expect(getAuthState()).toEqual({ tokens: null, user: null });
  });
});
