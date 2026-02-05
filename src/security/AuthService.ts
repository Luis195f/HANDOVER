import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';
import type { UserRole } from '@/src/security/auth-types';

const AUTH0_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? process.env.AUTH0_DOMAIN ?? '';

const AUTH0_CLIENT_ID =
  process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? process.env.AUTH0_CLIENT_ID ?? '';

const OIDC_ISSUER =
  (process.env.EXPO_PUBLIC_OIDC_ISSUER ??
    process.env.OIDC_ISSUER ??
    (AUTH0_DOMAIN ? `https://${AUTH0_DOMAIN}` : '')).replace(/\/$/, '');

const OIDC_CLIENT_ID =
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? process.env.OIDC_CLIENT_ID ?? AUTH0_CLIENT_ID;

const OIDC_SCOPE =
  process.env.EXPO_PUBLIC_OIDC_SCOPE ?? process.env.OIDC_SCOPE ?? 'openid profile email';

export type AuthTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
};

export type AuthUser = {
  id: string;
  name?: string;
  roles?: UserRole[];
  units?: string[];
};

export type AuthProviderResult = {
  tokens: AuthTokens;
  user: AuthUser;
};

export interface AuthProvider {
  login: (params: { username: string; password: string }) => Promise<AuthProviderResult>;
  refresh?: (refreshToken: string) => Promise<AuthTokens>;
}

const STORAGE_NAMESPACE = (process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
);

const TOKEN_KEY = `${STORAGE_NAMESPACE}_auth_tokens`;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
};

let migrationAttempted = false;

async function getLegacyAsyncStorage(): Promise<AsyncStorageLike | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    const storage =
      (mod as unknown as { default?: Partial<AsyncStorageLike> }).default ??
      (mod as unknown as Partial<AsyncStorageLike>);
    if (storage?.getItem && storage?.removeItem) return storage as AsyncStorageLike;
    return null;
  } catch {
    return null;
  }
}

async function migrateLegacyTokens(): Promise<AuthTokens | null> {
  if (migrationAttempted) return null;
  migrationAttempted = true;
  const legacy = await getLegacyAsyncStorage();
  if (!legacy) return null;
  const raw = await legacy.getItem(TOKEN_KEY).catch(() => null);
  if (!raw) return null;
  await secureSetItem(TOKEN_KEY, raw);
  await legacy.removeItem(TOKEN_KEY).catch(() => {});
  try {
    const parsed = JSON.parse(raw) as AuthTokens;
    if (!parsed?.accessToken || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? undefined,
      expiresAt: toIsoExpiresAt(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

function toIsoExpiresAt(expiresAt: string | number): string {
  if (typeof expiresAt === 'number') {
    const millis = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
    return new Date(millis).toISOString();
  }
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
  }
  return parsed.toISOString();
}

export function isTokenExpired(tokens: AuthTokens | null, nowMs: number = Date.now()): boolean {
  if (!tokens?.expiresAt) return true;
  const expMs = Date.parse(tokens.expiresAt);
  if (!Number.isFinite(expMs)) return true;
  return expMs <= nowMs;
}

export async function storeTokens(tokens: AuthTokens | null): Promise<void> {
  if (!tokens) {
    await secureDeleteItem(TOKEN_KEY);
    return;
  }
  const normalized: AuthTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? undefined,
    expiresAt: toIsoExpiresAt(tokens.expiresAt),
  };
  await secureSetItem(TOKEN_KEY, JSON.stringify(normalized));
}

export async function loadTokens(): Promise<AuthTokens | null> {
  const raw = await secureGetItem(TOKEN_KEY);
  if (!raw) return migrateLegacyTokens();
  try {
    const parsed = JSON.parse(raw) as AuthTokens;
    if (!parsed?.accessToken || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? undefined,
      expiresAt: toIsoExpiresAt(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await secureDeleteItem(TOKEN_KEY);
}

type OidcConfig = {
  issuer: string;
  clientId: string;
  scopes?: string[];
};

function buildOidcConfig(config?: Partial<OidcConfig>) {
  const issuer = config?.issuer ?? OIDC_ISSUER;
  const clientId = config?.clientId ?? OIDC_CLIENT_ID;
  const scopes = config?.scopes ?? OIDC_SCOPE.split(/\s+/).filter(Boolean);
  const isTestEnv = process.env.NODE_ENV === 'test';
  if (!isTestEnv) {
    if (!issuer) throw new Error('OIDC_ISSUER_MISSING');
    if (!clientId) throw new Error('OIDC_CLIENT_ID_MISSING');
  }
  return { issuer, clientId, scopes };
}

async function fetchDiscovery(issuer: string): Promise<{ token_endpoint?: string } | null> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return (await resp.json()) as { token_endpoint?: string };
}

async function refreshWithOidc(refreshToken: string, config?: Partial<OidcConfig>): Promise<AuthTokens> {
  const merged = buildOidcConfig(config);
  const discovery = await fetchDiscovery(merged.issuer);
  const tokenEndpoint = discovery?.token_endpoint;
  if (!tokenEndpoint) {
    throw new Error('OIDC_TOKEN_ENDPOINT_MISSING');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', merged.clientId);
  body.set('refresh_token', refreshToken);
  if (merged.scopes?.length) body.set('scope', merged.scopes.join(' '));

  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error('OIDC_REFRESH_FAILED');
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const newAccess =
    (data['access_token'] as string | undefined) ??
    (data['accessToken'] as string | undefined);
  if (!newAccess) {
    throw new Error('OIDC_REFRESH_FAILED');
  }

  const newRefresh =
    (data['refresh_token'] as string | undefined) ??
    (data['refreshToken'] as string | undefined) ??
    refreshToken;

  const expiresInRaw = data['expires_in'] ?? data['expiresIn'];
  const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);
  const expiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();

  return {
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresAt,
  };
}

export function createLocalAuthProvider(): AuthProvider {
  return {
    async login({ username, password }: { username: string; password: string }) {
      const normalizedUser = username.trim();
      if (!normalizedUser || !password) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (!(normalizedUser === 'demo' && password === 'demo')) {
        throw new Error('INVALID_CREDENTIALS');
      }

      const expiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
      const tokens: AuthTokens = {
        accessToken: `local-${normalizedUser}-${Date.now()}`,
        refreshToken: `local-refresh-${normalizedUser}`,
        expiresAt,
      };
      const user: AuthUser = {
        id: normalizedUser,
        name: normalizedUser,
        roles: [],
        units: [],
      };
      return { tokens, user };
    },
    async refresh(refreshToken: string) {
      if (!refreshToken.startsWith('local-refresh-')) {
        throw new Error('INVALID_REFRESH_TOKEN');
      }
      const expiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
      return {
        accessToken: `local-refresh-${Date.now()}`,
        refreshToken,
        expiresAt,
      };
    },
  };
}

export function createRemoteAuthProvider(): AuthProvider {
  return {
    async login() {
      throw new Error('LOGIN_UNSUPPORTED');
    },
    async refresh(refreshToken: string) {
      return refreshWithOidc(refreshToken);
    },
  };
}

export async function loginWithProvider(
  provider: AuthProvider,
  params: { username: string; password: string },
): Promise<AuthProviderResult> {
  const result = await provider.login(params);
  await storeTokens(result.tokens);
  return result;
}

export async function refreshWithProvider(
  provider: AuthProvider,
  refreshToken: string,
): Promise<AuthTokens> {
  if (!provider.refresh) {
    throw new Error('REFRESH_UNSUPPORTED');
  }
  const tokens = await provider.refresh(refreshToken);
  await storeTokens(tokens);
  return tokens;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens || isTokenExpired(tokens)) return null;
  return tokens.accessToken;
}

let defaultAuthProvider: AuthProvider = createRemoteAuthProvider();

export function setAuthProvider(provider: AuthProvider): void {
  defaultAuthProvider = provider;
}

export const AuthService = {
  login: (username: string, password: string) => loginWithProvider(defaultAuthProvider, { username, password }),
  refresh: (refreshToken: string) => refreshWithProvider(defaultAuthProvider, refreshToken),
  getAccessToken,
  storeTokens,
  loadTokens,
  clearTokens,
  isTokenExpired,
  setAuthProvider,
  createLocalAuthProvider,
  createRemoteAuthProvider,
};

export default AuthService;
