import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-auth-session');
vi.mock('@/src/security/secure-storage', () => {
  const store = new Map<string, string>();
  return {
    secureSetItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    secureGetItem: async (key: string) => (store.has(key) ? store.get(key)! : null),
    secureDeleteItem: async (key: string) => {
      store.delete(key);
    },
  };
});

const EXPIRES_SOON = new Date(Date.now() + 2_000).toISOString();

const setEnv = () => {
  process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.example';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client-123';
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE = 'api://aud';
  process.env.EXPO_PUBLIC_OIDC_SCOPES = 'openid profile email';
  process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI = 'handover-pro://callback';
  process.env.EXPO_PUBLIC_OIDC_LOGOUT_URI = 'handover-pro://logout';
};

beforeEach(() => {
  setEnv();
  const globalAny = globalThis as any;
  globalAny.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'NEW_ACCESS',
      refresh_token: 'ROTATED_REFRESH',
      expires_in: 1800,
    }),
  }));
});

describe('auth refresh', () => {
  it('refreshes expiring session and rotates tokens', async () => {
    const { setCurrentSession, getCurrentSession, ensureFreshAccessToken } = await import('@/src/security/auth');

    await setCurrentSession({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: EXPIRES_SOON,
      userId: 'user-1',
      displayName: 'User One',
      roles: ['nurse'],
      units: ['icu-a'],
    } as any);

    const token = await ensureFreshAccessToken('fhir');
    expect(token).toBe('NEW_ACCESS');

    const refreshed = await getCurrentSession();
    expect(refreshed?.accessToken).toBe('NEW_ACCESS');
    expect(refreshed?.refreshToken).toBe('ROTATED_REFRESH');
  });

  it('performs refresh in single flight when called concurrently', async () => {
    const { setCurrentSession, ensureFreshAccessToken } = await import('@/src/security/auth');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'NEW_ACCESS_SINGLE',
        refresh_token: 'NEW_REFRESH_SINGLE',
        expires_in: 1800,
      }),
    }));

    await setCurrentSession({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: EXPIRES_SOON,
      userId: 'user-1',
      displayName: 'User One',
      roles: ['nurse'],
      units: ['icu-a'],
    } as any);

    const [t1, t2] = await Promise.all([
      ensureFreshAccessToken('fhir'),
      ensureFreshAccessToken('fhir'),
    ]);

    expect(t1).toBe('NEW_ACCESS_SINGLE');
    expect(t2).toBe('NEW_ACCESS_SINGLE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
