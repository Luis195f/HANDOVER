import * as AuthSession from 'expo-auth-session';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';
import type { AuthSession as StoredAuthSession, HandoverSession, UserRole } from './auth-types';
import AuthService from './AuthService';

const DEPLOYMENT_MODE = (process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE ?? '').trim().toLowerCase();
const LOCAL_AUTH_BYPASS_ALLOWED =
  (typeof __DEV__ !== 'undefined' && __DEV__) &&
  (DEPLOYMENT_MODE === '' || DEPLOYMENT_MODE === 'development' || DEPLOYMENT_MODE === 'demo');

export const AUTH_DISABLED =
  LOCAL_AUTH_BYPASS_ALLOWED &&
  (process.env.EXPO_PUBLIC_AUTH_DISABLED ?? '').trim().toLowerCase() === 'true';

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

const RAW_OIDC_AUDIENCE =
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE ??
  process.env.OIDC_AUDIENCE ??
  process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ??
  '';

const OIDC_AUDIENCE = RAW_OIDC_AUDIENCE.trim() ? RAW_OIDC_AUDIENCE : undefined;

const OIDC_SCOPE =
  process.env.EXPO_PUBLIC_OIDC_SCOPE ??
  process.env.OIDC_SCOPE ??
  'openid profile email offline_access';

const REDIRECT_PATH_WEB = '--/redirect';
const LOGOUT_PATH_WEB = '--/logout';

const REDIRECT_PATH_NATIVE = 'redirect';
const LOGOUT_PATH_NATIVE = 'logout';

const WEB_ORIGIN =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:8081';

const REDIRECT_URI =
  Platform.OS === 'web'
    ? `${WEB_ORIGIN}/${REDIRECT_PATH_WEB}`
    : AuthSession.makeRedirectUri({
        scheme: 'handover-pro',
        path: REDIRECT_PATH_NATIVE,
      });

const LOGOUT_REDIRECT_URI =
  Platform.OS === 'web'
    ? `${WEB_ORIGIN}/${LOGOUT_PATH_WEB}`
    : AuthSession.makeRedirectUri({
        scheme: 'handover-pro',
        path: LOGOUT_PATH_NATIVE,
      });

const DEFAULT_AUTH_CONFIG = {
  issuer: OIDC_ISSUER,
  clientId: OIDC_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  logoutUri: LOGOUT_REDIRECT_URI,
  scopes: OIDC_SCOPE.split(/\s+/).filter(Boolean),
  ...(OIDC_AUDIENCE ? { audience: OIDC_AUDIENCE } : {}),
};

export type OAuthConfig = typeof DEFAULT_AUTH_CONFIG;

const STORAGE_NAMESPACE = (process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
);

const SESSION_KEY = `${STORAGE_NAMESPACE}_auth_session`;

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

function parseSession(raw: string | null): StoredAuthSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuthSession;
  } catch {
    return null;
  }
}

async function migrateLegacySession(): Promise<StoredAuthSession | null> {
  if (migrationAttempted) return null;
  migrationAttempted = true;
  const legacy = await getLegacyAsyncStorage();
  if (!legacy) return null;
  const raw = await legacy.getItem(SESSION_KEY).catch(() => null);
  if (!raw) return null;
  await secureSetItem(SESSION_KEY, raw);
  await legacy.removeItem(SESSION_KEY).catch(() => {});
  return parseSession(raw);
}

export async function loadStoredSession(): Promise<StoredAuthSession | null> {
  const raw = await secureGetItem(SESSION_KEY);
  if (raw) return parseSession(raw);
  return migrateLegacySession();
}

export async function storeSession(session: StoredAuthSession | null): Promise<void> {
  if (!session) {
    await secureDeleteItem(SESSION_KEY);
    return;
  }
  await secureSetItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearStoredSession(): Promise<void> {
  await secureDeleteItem(SESSION_KEY);
}

export function buildAuthConfig(config?: Partial<OAuthConfig>) {
  const audience =
    config?.audience?.trim() || (DEFAULT_AUTH_CONFIG as { audience?: string }).audience;

  const issuer = config?.issuer ?? DEFAULT_AUTH_CONFIG.issuer;
  const clientId = config?.clientId ?? DEFAULT_AUTH_CONFIG.clientId;

  const isTestEnv = process.env.NODE_ENV === 'test';
  if (!AUTH_DISABLED && !isTestEnv) {
    if (!issuer) throw new Error('OIDC_ISSUER_MISSING');
    if (!clientId) throw new Error('OIDC_CLIENT_ID_MISSING');
  }

  const scopes =
    config?.scopes ?? DEFAULT_AUTH_CONFIG.scopes;

  return {
    issuer,
    clientId,
    redirectUri: config?.redirectUri ?? DEFAULT_AUTH_CONFIG.redirectUri,
    logoutUri: config?.logoutUri ?? DEFAULT_AUTH_CONFIG.logoutUri,
    scopes: Array.isArray(scopes) ? scopes : String(scopes).split(/\s+/).filter(Boolean),
    ...(audience ? { audience } : {}),
  };
}

export function buildExtraParams(audience?: string) {
  const trimmed = audience?.trim();
  return trimmed ? { audience: trimmed } : undefined;
}

type AuthTokens = {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  issuedAt?: number;
  expiresIn?: number;
  expiresAt?: string;
  tokenType?: string;
};

async function fetchUserInfo(userInfoEndpoint: string | undefined, accessToken: string) {
  if (!userInfoEndpoint) return null;
  try {
    const res = await fetch(userInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    const [, payload] = idToken.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAuthParams(result: unknown): Record<string, string> | null {
  if (!result || typeof result !== 'object') return null;

  if ('params' in result) {
    const params = (result as { params?: unknown }).params;
    if (params && typeof params === 'object') {
      return params as Record<string, string>;
    }
  }

  const url = (result as { url?: unknown }).url;
  if (typeof url === 'string' && url.length > 0) {
    try {
      const u = new URL(url);
      return Object.fromEntries(u.searchParams.entries());
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeRoles(rawRoles: unknown): UserRole[] {
  const roles: string[] = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === 'string')
    : typeof rawRoles === 'string'
      ? rawRoles.split(/[,\s]+/).filter(Boolean)
      : [];

  const allowed: UserRole[] = [];
  for (const role of roles) {
    const normalized = role.trim().toLowerCase();
    if (
      normalized === 'nurse' ||
      normalized === 'supervisor' ||
      normalized === 'admin' ||
      normalized === 'viewer'
    ) {
      allowed.push(normalized as UserRole);
    }
  }
  return allowed;
}

function extractRoles(profile: Record<string, unknown>): UserRole[] {
  const rawRoles =
    profile['roles'] ??
    profile['role'] ??
    profile['app_metadata'] ??
    profile['https://handover.luis-soto.info/roles'] ??
    profile['https://api.luis-soto.info/roles'] ??
    profile['https://handover/roles'] ??
    profile['https://handoverpro/roles'];

  return normalizeRoles(rawRoles);
}

function extractUnits(profile: Record<string, unknown>): string[] {
  const unitsRaw = profile['units'] ?? profile['allowedUnits'];
  if (!unitsRaw) return [];
  if (Array.isArray(unitsRaw)) {
    return unitsRaw.filter((u): u is string => typeof u === 'string');
  }
  if (typeof unitsRaw === 'string') {
    return unitsRaw.split(',').map((u) => u.trim()).filter(Boolean);
  }
  return [];
}

async function resolveTokensFromResult(options: {
  request: AuthSession.AuthRequest;
  result: AuthSession.AuthSessionResult;
  discovery: AuthSession.DiscoveryDocument | null;
  clientId: string;
  redirectUri: string;
}): Promise<AuthTokens> {
  const { request, result, discovery, clientId, redirectUri } = options;

  const params = extractAuthParams(result);

  if (result.type !== 'success') {
    throw new Error(params?.error_description ?? 'OAUTH_CANCELLED');
  }

  if (result.authentication?.accessToken) {
    return {
      accessToken: result.authentication.accessToken,
      refreshToken: result.authentication.refreshToken ?? undefined,
      issuedAt: result.authentication.issuedAt ?? undefined,
      expiresIn: result.authentication.expiresIn ?? undefined,
      tokenType: result.authentication.tokenType ?? undefined,
    };
  }

  if (params?.access_token || params?.id_token) {
    return {
      accessToken: params.access_token,
      idToken: params.id_token,
      expiresIn: params.expires_in ? Number(params.expires_in) : undefined,
      tokenType: params.token_type,
    };
  }

  if (!discovery) {
    throw new Error('DISCOVERY_UNAVAILABLE');
  }

  const code = params?.code;
  if (!code) {
    throw new Error('OAUTH_CANCELLED');
  }

  if (!request.codeVerifier && request.codeChallengeMethod) {
    throw new Error('PKCE_CODE_VERIFIER_MISSING');
  }

  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code,
      redirectUri,
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
    },
    discovery,
  );

  return {
    accessToken: tokenResult.accessToken ?? (tokenResult as unknown as { access_token?: string }).access_token,
    refreshToken: tokenResult.refreshToken ?? undefined,
    idToken:
      (tokenResult as unknown as { id_token?: string; idToken?: string }).id_token ?? tokenResult.idToken,
    issuedAt: tokenResult.issuedAt ?? undefined,
    expiresIn: tokenResult.expiresIn ?? undefined,
    tokenType: tokenResult.tokenType ?? undefined,
  };
}

function normalizeExpiresAt(expiresAt: string | number | undefined): string | undefined {
  if (expiresAt == null) return undefined;
  if (typeof expiresAt === 'number') {
    const millis = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
    return new Date(millis).toISOString();
  }
  if (typeof expiresAt === 'string') {
    const numeric = Number(expiresAt);
    if (!Number.isNaN(numeric)) {
      const millis = numeric < 1e12 ? numeric * 1000 : numeric;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(expiresAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

async function buildSessionFromTokens(
  tokens: AuthTokens,
  discovery: AuthSession.DiscoveryDocument | null,
): Promise<HandoverSession> {
  if (!tokens.accessToken) {
    throw new Error('MISSING_ACCESS_TOKEN');
  }

  const userInfo = await fetchUserInfo(discovery?.userInfoEndpoint, tokens.accessToken);
  const decodedIdToken = decodeIdToken(tokens.idToken);
  const profile = { ...(decodedIdToken ?? {}), ...(userInfo ?? {}) } as Record<string, unknown>;

  const roles = extractRoles(profile);
  const units = extractUnits(profile);
  const userId = (profile['sub'] as string | undefined) ?? 'unknown-user';
  const displayName =
    (profile['name'] as string | undefined) ??
    (profile['preferred_username'] as string | undefined) ??
    (profile['nickname'] as string | undefined) ??
    userId;

  const issuedAt = tokens.issuedAt ?? Math.floor(Date.now() / 1000);
  const expiresIn = tokens.expiresIn ?? 3600;
  const expiresAt = tokens.expiresAt
    ? normalizeExpiresAt(tokens.expiresAt)
    : normalizeExpiresAt(issuedAt + expiresIn);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    expiresAt,
    userId,
    displayName,
    email: profile['email'] as string | undefined,
    picture: profile['picture'] as string | undefined,
    roles,
    units,
  } satisfies HandoverSession;
}

export async function loginWithOAuth(options: {
  config?: Partial<OAuthConfig>;
  promptAsync: (options?: AuthSession.AuthRequestPromptOptions) => Promise<AuthSession.AuthSessionResult>;
  discovery?: AuthSession.DiscoveryDocument | null;
  request: AuthSession.AuthRequest;
}): Promise<HandoverSession> {
  const config = buildAuthConfig(options.config);
  let discovery = options.discovery;

  if (!discovery) {
    discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);
  }

  const authResult = await options.promptAsync();

  if (authResult.type === 'dismiss') {
    const cancelledError = new Error('OAUTH_CANCELLED');
    (cancelledError as Error & { type?: string }).type = 'dismiss';
    throw cancelledError;
  }

  if (authResult.type === 'error') {
    const authError = new Error('OAUTH_FAILED');
    (authError as Error & { type?: string }).type = 'error';
    throw authError;
  }

  if (authResult.type !== 'success') {
    const cancelledError = new Error('OAUTH_CANCELLED');
    (cancelledError as Error & { type?: string }).type = authResult.type;
    throw cancelledError;
  }

  const tokens = await resolveTokensFromResult({
    request: options.request,
    result: authResult,
    discovery,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
  });

  return buildSessionFromTokens(tokens, discovery);
}

export async function refreshTokens(
  refreshToken: string,
  config?: Partial<OAuthConfig>,
): Promise<{ accessToken: string; refreshToken: string; expiresAt?: string } | null> {
  const merged = buildAuthConfig(config);
  const discovery = await AuthSession.fetchDiscoveryAsync(merged.issuer);
  const tokenEndpoint = discovery?.tokenEndpoint;
  if (!tokenEndpoint) return null;

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

  if (!resp.ok) return null;

  const data = (await resp.json()) as Record<string, unknown>;
  const newAccess =
    (data['access_token'] as string | undefined) ?? (data['accessToken'] as string | undefined);
  if (!newAccess) return null;

  const newRefresh =
    (data['refresh_token'] as string | undefined) ??
    (data['refreshToken'] as string | undefined) ??
    refreshToken;

  const expiresInRaw = data['expires_in'] ?? data['expiresIn'];
  const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);
  const nextExpiresAt = Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : undefined;

  return {
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresAt: nextExpiresAt,
  };
}

export const storeTokens = AuthService.storeTokens;
export const loadTokens = AuthService.loadTokens;
export const clearTokens = AuthService.clearTokens;
