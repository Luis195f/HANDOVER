import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionJson: string | null = null;

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => {},
  openAuthSessionAsync: vi.fn(async () => ({ type: 'success' })),
}));

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

vi.mock('@/src/navigation/navigation', () => ({
  default: { resetTo: vi.fn() },
}));

vi.mock('@/src/lib/fhir-client', () => ({
  configureFHIRClient: vi.fn(),
}));

vi.mock('@/src/demo/fixtures', () => ({
  ensureDemoSessionTemplate: vi.fn(),
}));

vi.mock('expo-auth-session', async () => ({
  ResponseType: { Code: 'code' },
  makeRedirectUri: () => 'handover-pro://callback',
  fetchDiscoveryAsync: vi.fn(async () => ({ tokenEndpoint: 'https://issuer.example/token' })),
  AuthRequest: class {
    constructor(_: any) {}
    promptAsync = vi.fn(async () => ({ type: 'success', params: { code: 'x' } }));
  },
}));

// IMPORTANT: mockea secure storage por alias (normalmente resuelve al mismo módulo)
vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: vi.fn(async (key: string) => {
    if (!sessionJson) return null;
    const k = (key ?? '').toLowerCase();
    if (k.includes('session') || k.includes('auth')) return sessionJson;
    return null;
  }),
  secureSetItem: vi.fn(async (key: string, value: string) => {
    const k = (key ?? '').toLowerCase();
    if (k.includes('session') || k.includes('auth')) sessionJson = value;
  }),
  secureDeleteItem: vi.fn(async (key: string) => {
    const k = (key ?? '').toLowerCase();
    if (k.includes('session') || k.includes('auth')) sessionJson = null;
  }),
}));

type EnsureFreshTokenFn = (target: string) => Promise<string>;

async function loadEnsureFreshToken(): Promise<EnsureFreshTokenFn> {
  const mod = await import('@/src/security/auth');

  const fn =
    (mod as any).ensureFreshToken ??
    (mod as any).default?.ensureFreshToken;

  if (typeof fn !== 'function') {
    throw new Error(
      "ensureFreshToken export not found. Export it from '@/src/security/auth' (named or default)."
    );
  }

  return fn as EnsureFreshTokenFn;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  sessionJson = null;

  process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.example';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client_test';
  process.env.EXPO_PUBLIC_OIDC_SCOPES = 'openid profile email offline_access';

  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'NEW_ACCESS',
      refresh_token: 'NEW_REFRESH',
      expires_in: 3600,
    }),
  }));
});

describe('auth refresh', () => {
  it('refreshes token when expiring', async () => {
    const ensureFreshToken = await loadEnsureFreshToken();

    sessionJson = JSON.stringify({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      user: { id: 'u', name: 'd', roles: ['nurse'], units: ['UCI'] },
    });

    const token = await ensureFreshToken('fhir');
    expect(token).toBe('NEW_ACCESS');
  });

  it('single-flight: concurrent refresh only hits token endpoint once', async () => {
    const ensureFreshToken = await loadEnsureFreshToken();

    sessionJson = JSON.stringify({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
      user: { id: 'u', name: 'd', roles: ['nurse'], units: ['UCI'] },
    });

    const [a, b] = await Promise.all([
      ensureFreshToken('fhir'),
      ensureFreshToken('fhir'),
    ]);

    expect(a).toBe('NEW_ACCESS');
    expect(b).toBe('NEW_ACCESS');
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });
});
