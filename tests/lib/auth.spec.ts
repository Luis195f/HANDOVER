import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStoreData = new Map<string, string>();
const promptAsyncMock = vi.fn();
const exchangeCodeAsyncMock = vi.fn();
const refreshAsyncMock = vi.fn();
const revokeAsyncMock = vi.fn();
const fetchDiscoveryAsyncMock = vi.fn();
const makeRedirectUriMock = vi.fn(() => 'app://redirect');

vi.mock('expo-secure-store', () => ({
  default: {
    getItemAsync: vi.fn(async (key: string) => secureStoreData.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      secureStoreData.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      secureStoreData.delete(key);
    }),
  },
}));

class MockAuthRequest {
  config: Record<string, unknown>;
  codeVerifier?: string;
  redirectUri?: string;
  constructor(config: Record<string, unknown>) {
    this.config = config;
    this.codeVerifier = 'mock-verifier';
    this.redirectUri = 'app://redirect';
  }
  promptAsync = promptAsyncMock;
}

vi.mock('expo-auth-session', () => ({
  ResponseType: { Code: 'code' },
  AuthRequest: MockAuthRequest,
  fetchDiscoveryAsync: fetchDiscoveryAsyncMock,
  makeRedirectUri: makeRedirectUriMock,
  exchangeCodeAsync: exchangeCodeAsyncMock,
  refreshAsync: refreshAsyncMock,
  revokeAsync: revokeAsyncMock,
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));

type ModuleType = typeof import('@/src/lib/auth');

type IdTokenPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  role?: string;
  unitIds?: string[];
  name?: string;
  email?: string;
};

const baseEnv = {
  OIDC_ISSUER: 'https://issuer.example',
  OIDC_CLIENT_ID: 'client-id',
  OIDC_AUDIENCE: 'aud-123',
  OIDC_SCOPE: 'openid profile email',
  OIDC_REDIRECT_SCHEME: 'app',
};

function withEnv(overrides: Partial<typeof baseEnv>, fn: () => Promise<void> | void) {
  const previous = Object.fromEntries(Object.entries(baseEnv).map(([k]) => [k, process.env[k]]));
  for (const [key, value] of Object.entries({ ...baseEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
      delete process.env[`EXPO_PUBLIC_${key}`];
    } else {
      process.env[key] = value;
      process.env[`EXPO_PUBLIC_${key}`] = value;
    }
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
        delete process.env[`EXPO_PUBLIC_${key}`];
      } else {
        process.env[key] = value;
        process.env[`EXPO_PUBLIC_${key}`] = value;
      }
    }
  });
}

function encodeSegment(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function buildIdToken(payload: IdTokenPayload): string {
  const header = encodeSegment(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = encodeSegment(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

async function importAuth(): Promise<ModuleType> {
  return import('@/src/lib/auth');
}

describe('auth loadOIDCConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    secureStoreData.clear();
  });

  it('loads config when all env vars are present', async () => {
    await withEnv({}, async () => {
      await expect(importAuth()).resolves.toBeDefined();
    });
  });

  const requiredKeys = [
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_AUDIENCE',
    'OIDC_SCOPE',
    'OIDC_REDIRECT_SCHEME',
  ] as const;

  requiredKeys.forEach((key) => {
    it(`throws when ${key} is missing or empty`, async () => {
      await withEnv({ [key]: ' ' } as Partial<typeof baseEnv>, async () => {
        await expect(importAuth()).rejects.toThrow(key);
      });
    });
  });
});

describe('token validation and hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    secureStoreData.clear();
    promptAsyncMock.mockReset();
    exchangeCodeAsyncMock.mockReset();
    refreshAsyncMock.mockReset();
    revokeAsyncMock.mockReset();
    fetchDiscoveryAsyncMock.mockResolvedValue({
      authorizationEndpoint: 'https://issuer.example/authorize',
      tokenEndpoint: 'https://issuer.example/token',
      userInfoEndpoint: 'https://issuer.example/userinfo',
      revocationEndpoint: 'https://issuer.example/revoke',
    });
    makeRedirectUriMock.mockReturnValue('app://redirect');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sub: 'user-123', name: 'Tester', role: 'nurse', unitIds: ['icu'] }),
    })) as unknown as typeof fetch;
  });

  it('restores a valid session from stored tokens', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildIdToken({
      iss: baseEnv.OIDC_ISSUER,
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      sub: 'user-123',
      role: 'nurse',
      unitIds: ['icu'],
    });

    await withEnv({}, async () => {
      const auth = await importAuth();
      await auth.persistAuth(
        {
          accessToken: 'stored-access',
          refreshToken: 'stored-refresh',
          expiresAt: exp,
          idToken,
          scope: baseEnv.OIDC_SCOPE,
        },
        { sub: 'user-123', role: 'nurse', unitIds: ['icu'], name: 'Tester' }
      );

      const token = await auth.ensureFreshToken();
      expect(token).toBe('stored-access');
      expect(auth.getCurrentUser()?.sub).toBe('user-123');
      expect(auth.getCurrentUser()?.role).toBe('nurse');
    });
  });

  it('clears session when token is expired', async () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const idToken = buildIdToken({
      iss: baseEnv.OIDC_ISSUER,
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      sub: 'user-123',
      role: 'nurse',
      unitIds: ['icu'],
    });
    const namespace = 'handover';
    secureStoreData.set(`${namespace}:auth:access`, 'stored-access');
    secureStoreData.set(`${namespace}:auth:exp`, String(exp));
    secureStoreData.set(`${namespace}:auth:id`, idToken);

    await withEnv({}, async () => {
      const auth = await importAuth();
      await expect(auth.ensureFreshToken()).rejects.toThrow(/not authenticated/i);
      expect(auth.getCurrentUser()).toBeNull();
    });
  });

  it('clears session when issuer or audience mismatch', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildIdToken({
      iss: 'https://evil.example',
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      sub: 'user-123',
      role: 'nurse',
    });
    const namespace = 'handover';
    secureStoreData.set(`${namespace}:auth:access`, 'stored-access');
    secureStoreData.set(`${namespace}:auth:exp`, String(exp));
    secureStoreData.set(`${namespace}:auth:id`, idToken);

    await withEnv({}, async () => {
      const auth = await importAuth();
      await expect(auth.ensureFreshToken()).rejects.toThrow();
      expect(auth.getCurrentUser()).toBeNull();
    });
  });

  it('does not create a session when id token is missing required claims', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildIdToken({
      iss: baseEnv.OIDC_ISSUER,
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      role: 'nurse',
    });
    const namespace = 'handover';
    secureStoreData.set(`${namespace}:auth:access`, 'stored-access');
    secureStoreData.set(`${namespace}:auth:exp`, String(exp));
    secureStoreData.set(`${namespace}:auth:id`, idToken);

    await withEnv({}, async () => {
      const auth = await importAuth();
      await expect(auth.ensureFreshToken()).rejects.toThrow();
      expect(auth.getCurrentUser()).toBeNull();
    });
  });
});

describe('auth flow outcomes', () => {
  beforeEach(() => {
    vi.resetModules();
    secureStoreData.clear();
    promptAsyncMock.mockReset();
    exchangeCodeAsyncMock.mockReset();
    refreshAsyncMock.mockReset();
    revokeAsyncMock.mockReset();
    fetchDiscoveryAsyncMock.mockResolvedValue({
      authorizationEndpoint: 'https://issuer.example/authorize',
      tokenEndpoint: 'https://issuer.example/token',
      userInfoEndpoint: 'https://issuer.example/userinfo',
      revocationEndpoint: 'https://issuer.example/revoke',
    });
    makeRedirectUriMock.mockReturnValue('app://redirect');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sub: 'user-123', role: 'nurse', unitIds: ['icu'] }),
    })) as unknown as typeof fetch;
  });

  it('returns cancelled result without persisting tokens', async () => {
    promptAsyncMock.mockResolvedValue({ type: 'cancel' });
    await withEnv({}, async () => {
      const auth = await importAuth();
      const result = await auth.loginWithOIDC();
      expect(result.status).toBe('cancelled');
      expect(secureStoreData.size).toBe(0);
      expect(auth.getCurrentUser()).toBeNull();
    });
  });

  it('persists session on successful code exchange', async () => {
    promptAsyncMock.mockResolvedValue({ type: 'success', params: { code: 'abc123' } });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildIdToken({
      iss: baseEnv.OIDC_ISSUER,
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      sub: 'user-123',
      role: 'nurse',
      unitIds: ['icu'],
    });
    exchangeCodeAsyncMock.mockResolvedValue({
      accessToken: 'exchanged-access',
      refreshToken: 'exchanged-refresh',
      expiresIn: 3600,
      idToken,
      scope: baseEnv.OIDC_SCOPE,
    });

    await withEnv({}, async () => {
      const auth = await importAuth();
      const result = await auth.loginWithOIDC();
      expect(result.status).toBe('success');
      expect(auth.getCurrentUser()?.sub).toBe('user-123');
      expect(auth.getCurrentUser()).not.toBeNull();
    });
  });

  it('returns error result when exchange fails', async () => {
    promptAsyncMock.mockResolvedValue({ type: 'success', params: { code: 'abc123' } });
    exchangeCodeAsyncMock.mockRejectedValue(new Error('network down'));

    await withEnv({}, async () => {
      const auth = await importAuth();
      await expect(auth.loginWithOIDC()).rejects.toThrow();
      expect(auth.getCurrentUser()).toBeNull();
      expect(secureStoreData.size).toBe(0);
    });
  });
});

describe('storage, logout, and public profile', () => {
  beforeEach(() => {
    vi.resetModules();
    secureStoreData.clear();
    promptAsyncMock.mockReset();
    exchangeCodeAsyncMock.mockReset();
    refreshAsyncMock.mockReset();
    revokeAsyncMock.mockReset();
    fetchDiscoveryAsyncMock.mockResolvedValue({
      authorizationEndpoint: 'https://issuer.example/authorize',
      tokenEndpoint: 'https://issuer.example/token',
      userInfoEndpoint: 'https://issuer.example/userinfo',
      revocationEndpoint: 'https://issuer.example/revoke',
    });
    makeRedirectUriMock.mockReturnValue('app://redirect');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sub: 'user-123', role: 'nurse', unitIds: ['icu'] }),
    })) as unknown as typeof fetch;
  });

  it('stores tokens on successful login and clears on logout', async () => {
    promptAsyncMock.mockResolvedValue({ type: 'success', params: { code: 'abc123' } });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildIdToken({
      iss: baseEnv.OIDC_ISSUER,
      aud: baseEnv.OIDC_AUDIENCE,
      exp,
      sub: 'user-123',
      role: 'nurse',
      unitIds: ['icu'],
    });
    exchangeCodeAsyncMock.mockResolvedValue({
      accessToken: 'exchanged-access',
      refreshToken: 'exchanged-refresh',
      expiresIn: 3600,
      idToken,
      scope: baseEnv.OIDC_SCOPE,
    });

    await withEnv({}, async () => {
      const auth = await importAuth();
      await auth.loginWithOIDC();
      expect(auth.getCurrentUser()).not.toBeNull();
      await auth.logout();
      expect(auth.getCurrentUser()).toBeNull();
    });
  });

  it('public profile omits tokens', async () => {
    await withEnv({}, async () => {
      const auth = await importAuth();
      await auth.loginWithMockUser({ sub: 'user-123', role: 'nurse', unitIds: ['icu'] });
      const profile = auth.getPublicProfile();
      expect(profile.user?.sub).toBe('user-123');
      expect(profile).not.toHaveProperty('accessToken');
      expect(profile).not.toHaveProperty('refreshToken');
    });
  });
});
