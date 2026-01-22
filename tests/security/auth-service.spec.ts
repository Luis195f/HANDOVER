import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@/src/security/secure-storage', () => ({
  secureSetItem: async (key: string, value: string) => {
    storage.set(key, value);
  },
  secureGetItem: async (key: string) => storage.get(key) ?? null,
  secureDeleteItem: async (key: string) => {
    storage.delete(key);
  },
}));

describe('AuthService token storage', () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it('persiste y recupera tokens', async () => {
    const { storeTokens, loadTokens } = await import('@/src/security/AuthService');
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await storeTokens({ accessToken: 'token-123', refreshToken: 'refresh-123', expiresAt });

    await expect(loadTokens()).resolves.toEqual({
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      expiresAt,
    });
  });

  it('elimina tokens almacenados', async () => {
    const { storeTokens, loadTokens, clearTokens } = await import('@/src/security/AuthService');
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await storeTokens({ accessToken: 'token-456', refreshToken: 'refresh-456', expiresAt });
    await clearTokens();

    await expect(loadTokens()).resolves.toBeNull();
  });
});
