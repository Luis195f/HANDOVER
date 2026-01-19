import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * tests/security/auth.refresh.spec.ts
 *
 * - ensureFreshToken/ensureFreshAccessToken refresca cuando el token expira pronto.
 * - "single-flight": llamadas concurrentes comparten 1 solo refresh.
 *
 * Este módulo importa Expo/React Native; por eso se mockean dependencias.
 * Importante: NO se mockea el módulo bajo test.
 */

const store = new Map<string, string>();

function sessionKey(): string {
  const nsRaw = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover';
  const ns = nsRaw.replace(/[^\w.-]/g, '') || 'handover';
  return `${ns}_auth_session`;
}

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => {},
  openAuthSessionAsync: vi.fn(),
  dismissBrowser: vi.fn(),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    Platform: {
      OS: "web",
      select: (spec: any) => spec?.web ?? spec?.default ?? spec?.ios ?? spec?.android,
    },
  };
});

vi.mock('@/src/navigation/navigation', () => ({
  default: { resetRoot: vi.fn() },
}));

vi.mock('@/src/lib/fhir-client', () => ({
  configureFHIRClient: vi.fn(),
}));

vi.mock('@/src/demo/fixtures', () => ({
  ensureDemoSessionTemplate: vi.fn(async () => null),
}));

// secure storage usado por src/security/auth.tsx
vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: vi.fn(async (key: string) => store.get(key) ?? null),
  secureSetItem: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  secureDeleteItem: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

// expo-auth-session (namespace import en src/security/auth.tsx)
vi.mock('expo-auth-session', () => ({
  ResponseType: { Code: 'code' },
  makeRedirectUri: vi.fn(() => 'handover-pro://redirect'),
  fetchDiscoveryAsync: vi.fn(async () => ({
    issuer: 'https://issuer.example',
    tokenEndpoint: 'https://issuer.example/token',
    authorizationEndpoint: 'https://issuer.example/authorize',
  })),
  exchangeCodeAsync: vi.fn(async () => ({
    accessToken: 'NEW_ACCESS',
    refreshToken: 'NEW_REFRESH',
    expiresIn: 3600,
  })),
}));

// hook usado por login (no se ejecuta en estos tests, pero debe existir)
vi.mock('expo-auth-session/providers/auth0', () => ({
  useAuthRequest: () => [null, null, vi.fn()],
}));

async function loadEnsureFresh() {
  const mod = await import('../../src/security/auth');
  const ensureFresh =
    (mod as any).ensureFreshAccessToken ??
    (mod as any).ensureFreshToken;

  if (typeof ensureFresh !== 'function') {
    throw new Error(
      'No se encontró ensureFreshAccessToken/ensureFreshToken exportado desde src/security/auth.tsx.'
    );
  }
  return { ensureFresh };
}

function seedSession(opts: { accessToken: string; refreshToken?: string; expiresAt: string }) {
  store.set(
    sessionKey(),
    JSON.stringify({
      // Campos relevantes para ensureFreshToken
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      expiresAt: opts.expiresAt,

      // Campos extra para compatibilidad con normalizeSession (no usados en este spec)
      userId: 'u1',
      displayName: 'User One',
      roles: ['nurse'],
      units: ['ward'],
    })
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  store.clear();

  process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.example';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client_test';
  process.env.EXPO_PUBLIC_OIDC_SCOPES = 'openid profile email offline_access';
  process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = 'handover';

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
  it('refreshes expiring session and rotates tokens', async () => {
    seedSession({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(), // expirado
    });

    const { ensureFresh } = await loadEnsureFresh();

    const token = await ensureFresh('fhir');
    expect(token).toBe('NEW_ACCESS');

    // persistió sesión rotada
    const persisted = store.get(sessionKey());
    expect(persisted).toBeTruthy();
    const parsed = JSON.parse(persisted as string);
    expect(parsed.accessToken).toBe('NEW_ACCESS');
    expect(parsed.refreshToken).toBe('NEW_REFRESH');

    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('performs refresh in single flight when called concurrently', async () => {
    seedSession({
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    });

    const { ensureFresh } = await loadEnsureFresh();

    const [t1, t2] = await Promise.all([ensureFresh('fhir'), ensureFresh('fhir')]);
    expect(t1).toBe('NEW_ACCESS');
    expect(t2).toBe('NEW_ACCESS');
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });
});

