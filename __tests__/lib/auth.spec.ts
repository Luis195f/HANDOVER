import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, getAuthState } from '@/src/state/auth-store';
import { ensureFreshToken, loginWithMockUser, logout, onAuthStateChange } from '@/src/lib/auth';

describe('auth helpers', () => {
  afterEach(() => {
    clearAuthState();
  });

  it('loginWithMockUser persiste usuario y tokens simulados', async () => {
    await loginWithMockUser({ sub: 'user-1', name: 'Jane', unitIds: ['icu-west'] });

    const state = getAuthState();
    expect(state.user).toEqual({
      sub: 'user-1',
      name: 'Jane',
      email: undefined,
      role: 'nurse',
      unitIds: ['icu-west'],
    });
    expect(state.tokens?.accessToken).toBeTruthy();
    expect(state.tokens?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('logout limpia el estado y notifica suscriptores', async () => {
    const listener = vi.fn();
    const unsubscribe = onAuthStateChange(listener);

    await loginWithMockUser({ sub: 'user-2', role: 'viewer', unitIds: [] });
    await logout();

    const state = getAuthState();
    expect(state).toEqual({ user: null, tokens: null });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('ensureFreshToken lanza cuando no hay sesión activa', async () => {
    await expect(ensureFreshToken()).rejects.toThrow('User is not authenticated');
  });
});
