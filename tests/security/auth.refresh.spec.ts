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

/**
 * En el código real el key puede cambiar con refactors.
 * Mantén este helper, pero en el test vamos a sembrar en varias variantes
 * para no depender de un string rígido.
 */
function sessionKeyFromNamespace(nsRaw?: string): string {
  const ns = (nsRaw ?? process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover')
    .replace(/[^\w.-]/g, '') || 'handover';
  return `${ns}_auth_session`;
}

/**
 * Algunos builds históricos han usado variantes. Sembramos varias para
 * hacer el test robusto a refactors (sin tocar el módulo real).
 */
function candidateSessionKeys(): string[] {
  const nsRaw = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover';
  const ns = nsRaw.replace(/[^\w.-]/g, '') || 'handover';

  const candidates = new Set<string>([
    // actual del test original
    `${ns}_auth_session`,
    // variantes comunes
    `${ns}_auth.session`,
    `${ns}_auth-session`,
    `${ns}_session`,
    `${ns}_oidc_session`,
    `${ns}_oidc.session`,
    `${ns}_oidc-session`,
    // “handoverpro” a veces aparece por branding/envs
    `handover-pro_auth_session`,
    `handoverpro_auth_session`,
  ]);

  return Array.from(candidates);
}

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => {},
  openAuthSessionAsync: vi.fn(),
  dismissBrowser: vi.fn(),
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

vi.mock('@/src/navigation/navigation', () => ({
  default: { resetRoot: vi.fn() },
}));

vi.mock('@/src/lib/fhir-client', () => ({
  configureFHIRClient: vi.fn(),
}));

vi.mock('@/src/demo/fixtures', () => ({
  ensureDemoSessionTemplate: vi.fn(async () => null),
}));

// secure storage usado por src/security/auth.ts(x)
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

type EnsureFreshFn = (audienceOrService?: string) => Promise<string | null>;

async function loadEnsureFresh() {
  const mod = await import('../../src/security/auth');

  const ensureFresh: EnsureFreshFn =
    (mod as any).ensureFreshAccessToken ??
    (mod as any).ensureFreshToken ??
    (mod as any).ensureFresh;

  if (typeof ensureFresh !== 'function') {
    throw new Error(
      'No se encontró ensureFreshAccessToken/ensureFreshToken exportado desde src/security/auth.ts(x).'
    );
  }

  /**
   * Si el módulo exporta algún key oficial (muchos proyectos lo hacen),
   * lo aprovechamos para sembrar exactamente donde lee el runtime.
   */
  const exportedKey =
    (mod as any).AUTH_SESSION_KEY ??
    (mod as any).AUTH_SESSION_STORAGE_KEY ??
    (mod as any).SESSION_KEY ??
    (mod as any).SESSION_STORAGE_KEY;

  const keys: string[] = [];
  if (typeof exportedKey === 'string' && exportedKey.trim()) {
    keys.push(exportedKey);
  }
  // Siempre agregamos nuestras candidatas.
  for (const k of candidateSessionKeys()) keys.push(k);

  // Dedup manteniendo orden
  const dedup = Array.from(new Set(keys));

  return { ensureFresh, sessionKeys: dedup };
}

function buildSessionPayload(opts: { accessToken: string; refreshToken?: string; expiresAt: string }) {
  const expiresAtIso = opts.expiresAt;

  // Compat: algunos módulos usan epoch ms
  const expiresAtMs = Date.parse(expiresAtIso);
  // Compat: otros usan expiresOn (ISO)
  const expiresOn = expiresAtIso;

  return {
    // Campos mínimos
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    expiresAt: expiresAtIso,

    // Compat extra
    expiresAtMs,
    expiresOn,
    tokenType: 'Bearer',
    scope: process.env.EXPO_PUBLIC_OIDC_SCOPE ?? 'openid profile email offline_access',
    audience: process.env.EXPO_PUBLIC_OIDC_AUDIENCE ?? 'https://api.luis-soto.info',
    issuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://issuer.example',
    clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? 'client_test',
    mode: 'oidc', // importante: evitar caer a demo si el módulo usa mode

    // Campos extra para compatibilidad con normalizeSession (no usados en este spec)
    userId: 'u1',
    userSub: 'u1',
    displayName: 'User One',
    roles: ['nurse'],
    units: ['ward'],
    permissions: [],
  };
}

function seedSessionInto(keys: string[], opts: { accessToken: string; refreshToken?: string; expiresAt: string }) {
  const payload = JSON.stringify(buildSessionPayload(opts));
  for (const key of keys) {
    store.set(key, payload);
  }
}

// Helper por si algún test/debug todavía quiere el “key original”
function sessionKey(): string {
  return sessionKeyFromNamespace(process.env.EXPO_PUBLIC_STORAGE_NAMESPACE);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  store.clear();

  // ENV mínimas para que el módulo no haga early-exit
  process.env.EXPO_PUBLIC_ENV = 'development';
  process.env.EXPO_PUBLIC_AUTH_DISABLED = 'false';

  process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.example';
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client_test';
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE = 'https://api.luis-soto.info';
  process.env.EXPO_PUBLIC_OIDC_SCOPE = 'openid profile email offline_access';
  process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = 'handover';

  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'NEW_ACCESS',
      refresh_token: 'NEW_REFRESH',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
  }));
});

describe('auth refresh', () => {
  it('refreshes expiring session and rotates tokens', async () => {
    const { ensureFresh, sessionKeys } = await loadEnsureFresh();

    seedSessionInto(sessionKeys, {
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(), // expirado
    });

    const token = await ensureFresh('fhir');
    expect(token).toBe('NEW_ACCESS');

    // persistió sesión rotada: verificamos en al menos 1 key (la que realmente usa)
    const persisted = sessionKeys.map((k) => store.get(k)).find(Boolean);
    expect(persisted).toBeTruthy();

    const parsed = JSON.parse(persisted as string);
    expect(parsed.accessToken).toBe('NEW_ACCESS');
    expect(parsed.refreshToken).toBe('NEW_REFRESH');

    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('performs refresh in single flight when called concurrently', async () => {
    const { ensureFresh, sessionKeys } = await loadEnsureFresh();

    seedSessionInto(sessionKeys, {
      accessToken: 'OLD_ACCESS',
      refreshToken: 'OLD_REFRESH',
      expiresAt: new Date(Date.now() - 10_000).toISOString(),
    });

    const [t1, t2] = await Promise.all([ensureFresh('fhir'), ensureFresh('fhir')]);
    expect(t1).toBe('NEW_ACCESS');
    expect(t2).toBe('NEW_ACCESS');
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
  });
});
