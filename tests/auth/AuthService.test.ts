import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthService,
  MOCK_CREDENTIALS,
  MOCK_TOKEN,
  MOCK_USER,
  type SecureStoreAdapter,
} from '@/src/lib/auth/AuthService';
import type { AuthState } from '@/src/lib/auth/types';

function createMemorySecureStore() {
  const store = new Map<string, string>();
  const adapter: SecureStoreAdapter = {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
    del: async (key) => {
      store.delete(key);
    },
  };
  return { adapter, store };
}

describe('AuthService (mock provider)', () => {
  let adapter: SecureStoreAdapter;
  let service: AuthService;

  beforeEach(() => {
    ({ adapter } = createMemorySecureStore());
    service = new AuthService(adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in with fixed credentials and persists state', async () => {
    const state = await service.login(MOCK_CREDENTIALS);

    expect(state.user).toEqual(MOCK_USER);
    expect(state.token?.accessToken).toBe(MOCK_TOKEN.accessToken);

    const rehydrated = new AuthService(adapter);
    const restored = await rehydrated.getAuthState();

    expect(restored.user).toEqual(MOCK_USER);
    expect(restored.token?.accessToken).toBe(MOCK_TOKEN.accessToken);
  });

  it('rejects invalid credentials', async () => {
    await expect(
      service.login({ username: 'bad@example.com', password: 'nope' })
    ).rejects.toThrow('INVALID_CREDENTIALS');
  });

  it('clears state on logout', async () => {
    await service.login(MOCK_CREDENTIALS);
    await service.logout();

    const next = new AuthService(adapter);
    expect(await next.getCurrentUser()).toBeNull();
    expect(await next.getAccessToken()).toBeNull();
  });

  it('notifies subscribers on auth changes', async () => {
    const updates: AuthState[] = [];
    const unsubscribe = service.subscribe((state) => {
      updates.push(state);
    });

    await service.login(MOCK_CREDENTIALS);
    await service.logout();
    unsubscribe();

    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates[0]).toEqual({ user: null, token: null });
    expect(updates.at(-1)).toEqual({ user: null, token: null });
  });
});
