import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = new Map<string, string>();
const legacyStore = new Map<string, string>();

vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: vi.fn(async (key: string) => secureStore.get(key) ?? null),
  secureSetItem: vi.fn(async (key: string, value: string) => {
    secureStore.set(key, value);
  }),
  secureDeleteItem: vi.fn(async (key: string) => {
    secureStore.delete(key);
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => legacyStore.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      legacyStore.delete(key);
    }),
  },
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(() => 'handover-pro://redirect'),
  fetchDiscoveryAsync: vi.fn(async () => ({
    issuer: 'https://issuer.example',
    tokenEndpoint: 'https://issuer.example/token',
    authorizationEndpoint: 'https://issuer.example/authorize',
  })),
  exchangeCodeAsync: vi.fn(async () => ({
    accessToken: 'ACCESS',
    refreshToken: 'REFRESH',
    expiresIn: 3600,
    idToken: 'header.payload.signature',
  })),
}));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: {
      OS: 'web',
      select: (spec: any) => spec?.web ?? spec?.default ?? spec?.ios ?? spec?.android,
    },
  };
});

function sessionKey(): string {
  const nsRaw = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover';
  const ns = nsRaw.replace(/[^\w.-]/g, '') || 'handover';
  return `${ns}_auth_session`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  secureStore.clear();
  legacyStore.clear();

  process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.example';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client_test';
  process.env.EXPO_PUBLIC_OIDC_SCOPE = 'openid profile email offline_access';
  process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = 'handover';
});

describe('OAuthService', () => {
  it('builds a session from an OAuth code exchange', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        name: 'Test User',
        roles: ['nurse'],
        units: ['UCI'],
      }),
    ).toString('base64');
    const idToken = `header.${payload}.signature`;

    const AuthSession = await import('expo-auth-session');
    (AuthSession.exchangeCodeAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      accessToken: 'ACCESS',
      refreshToken: 'REFRESH',
      expiresIn: 3600,
      idToken,
    });

    const { loginWithOAuth } = await import('@/src/security/OAuthService');

    const session = await loginWithOAuth({
      promptAsync: async () => ({
        type: 'success',
        params: { code: 'auth_code' },
      }),
      request: { codeVerifier: 'verifier', codeChallengeMethod: 'S256' } as any,
    });

    expect(session.accessToken).toBe('ACCESS');
    expect(session.refreshToken).toBe('REFRESH');
    expect(session.userId).toBe('user-1');
    expect(session.roles).toContain('nurse');
    expect(session.units).toContain('UCI');
  });

  it('migrates legacy session storage to SecureStore', async () => {
    legacyStore.set(
      sessionKey(),
      JSON.stringify({
        accessToken: 'LEGACY',
        refreshToken: 'LEGACY_REFRESH',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        userId: 'legacy-user',
        displayName: 'Legacy User',
        roles: ['nurse'],
        units: ['UCI'],
      }),
    );

    const { loadStoredSession } = await import('@/src/security/OAuthService');
    const session = await loadStoredSession();

    expect(session?.accessToken).toBe('LEGACY');
    expect(secureStore.get(sessionKey())).toBeTruthy();
    expect(legacyStore.get(sessionKey())).toBeUndefined();
  });
});
