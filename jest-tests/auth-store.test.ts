import { clearAuthState, getAuthState, isTokenExpiringSoon, setAuthState, subscribe, updateAuthState, type AuthState } from '@/src/state/auth-store';

const sampleState: AuthState = {
  user: { sub: '123', role: 'nurse', unitIds: ['icu'], name: 'Test Nurse', email: 'nurse@example.com' },
  tokens: { accessToken: 'abc', refreshToken: 'def', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
};

describe('auth-store', () => {
  afterEach(() => {
    clearAuthState();
  });

  test('getAuthState returns cloned state', () => {
    setAuthState(sampleState);
    const first = getAuthState();
    expect(first).not.toBe(sampleState);
    expect(first.user?.sub).toBe('123');
    first.user!.unitIds.push('new');
    const second = getAuthState();
    expect(second.user?.unitIds).toEqual(['icu']);
  });

  test('updateAuthState merges partial values', () => {
    setAuthState(sampleState);
    updateAuthState({ user: { sub: '456', role: 'admin', unitIds: ['er'] } });
    const state = getAuthState();
    expect(state.user?.sub).toBe('456');
    expect(state.tokens?.accessToken).toBe('abc');
  });

  test('clearAuthState resets to defaults', () => {
    setAuthState(sampleState);
    clearAuthState();
    const state = getAuthState();
    expect(state.user).toBeNull();
    expect(state.tokens).toBeNull();
  });

  test('subscribe notifies listeners on changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);
    setAuthState(sampleState);
    expect(listener).toHaveBeenCalledTimes(1);
    updateAuthState({ user: { sub: '789', role: 'viewer', unitIds: [] } });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    updateAuthState({ user: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('isTokenExpiringSoon respects threshold', () => {
    const now = Math.floor(Date.now() / 1000);
    setAuthState({
      user: sampleState.user,
      tokens: { accessToken: 'token', refreshToken: null, expiresAt: now + 30 },
    });
    expect(isTokenExpiringSoon()).toBe(true);
    updateAuthState({ tokens: { accessToken: 'token', refreshToken: null, expiresAt: now + 120 } });
    expect(isTokenExpiringSoon()).toBe(false);
  });
});
