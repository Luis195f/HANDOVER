// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { Buffer } from 'buffer';

import { ensureDemoSessionTemplate } from '@/src/demo/fixtures';
import type { AuthSession as StoredAuthSession, HandoverSession, HandoverUser, UserRole } from './auth-types';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';
import navigation from '@/src/navigation/navigation';
import { configureFHIRClient } from '@/src/lib/fhir-client';

const AUTH_DISABLED =
  (process.env.EXPO_PUBLIC_AUTH_DISABLED ?? '').trim().toLowerCase() === 'true';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

type AuthWarnCode =
  | 'AUTH_RUNTIME_CONFIG'
  | 'AUTH_OIDC_MISCONFIG'
  | 'AUTH_LOGIN_START'
  | 'AUTH_LOGIN_RESULT'
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_CANCELLED'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_LOGOUT'
  | 'AUTH_REFRESH_START'
  | 'AUTH_REFRESH_SUCCESS'
  | 'AUTH_REFRESH_FAILED'
  | 'AUTH_REFRESH_NO_TOKEN_ENDPOINT'
  | 'AUTH_REFRESH_ERROR'
  | 'AUTH_REQUEST_NOT_READY';

const AUTH_WARN_PREFIX = '[AUTH]';

/**
 * Logger de eventos de autenticación (solo en DEV).
 * Importante: no loguear PHI ni secretos (tokens, auth headers, emails, etc.).
 */
function warnAuth(code: AuthWarnCode, meta: Record<string, unknown> = {}): void {
  if (!isDev) return;

  const redacted: Record<string, unknown> = { ...meta };
  const redactKeys = ['access', 'refresh', 'id_token', 'token', 'authorization', 'email'];
  for (const k of Object.keys(redacted)) {
    const key = k.toLowerCase();
    if (redactKeys.some((rk) => key.includes(rk))) {
      redacted[k] = '[REDACTED]';
    }
  }

  // eslint-disable-next-line no-console
  console.warn(AUTH_WARN_PREFIX, code, redacted);
}

let refreshInFlight: Promise<string | null> | null = null;
const REFRESH_SKEW_MS = 60_000;


try {
  WebBrowser.maybeCompleteAuthSession();
} catch (error) {
  if (isDev) console.warn('[auth] Failed to complete auth session', error);
}

// BEGIN HANDOVER: AUTH_CONFIG
const AUTH0_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? 'dev-6jmxxysflz2kx61w.us.auth0.com';

const AUTH0_CLIENT_ID =
  process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? 'zJxhI0SK1J4hmzr1KNzEbWddgZWJDUlL';

const REDIRECT_URI =
  process.env.EXPO_PUBLIC_AUTH0_REDIRECT_URI ??
  AuthSession.makeRedirectUri({
    native: 'handover-pro://callback',
    scheme: 'handover-pro',
    path: 'callback',
  });

// EXPO_PUBLIC_AUTH0_LOGOUT_URI debe ser un deep link válido (ej: handover-pro://auth/logout) cuando se defina.
const LOGOUT_REDIRECT_URI =
  process.env.EXPO_PUBLIC_AUTH0_LOGOUT_URI ??
  AuthSession.makeRedirectUri({ path: 'auth/logout' });

const DEFAULT_AUTH_CONFIG = {
  issuer: `https://${AUTH0_DOMAIN}`,
  clientId: AUTH0_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  logoutUri: LOGOUT_REDIRECT_URI,
  scopes: ['openid', 'profile', 'email'],
};
// END HANDOVER: AUTH_CONFIG

type SessionModel = HandoverSession;

type LogoutOptions = {
  skipRemote?: boolean;
  message?: string;
};

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
      (mod as unknown as { default?: Partial<AsyncStorageLike> }).default ?? (mod as unknown as Partial<AsyncStorageLike>);
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

function toIsoExpiresAt(value: string | number | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    const millis = value < 1e12 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      const millis = numeric < 1e12 ? numeric * 1000 : numeric;
      const dateFromNumber = new Date(millis);
      if (!Number.isNaN(dateFromNumber.getTime())) return dateFromNumber.toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

function normalizeExpiresAt(expiresAt: string | number | undefined): string | undefined {
  return toIsoExpiresAt(expiresAt);
}

function normalizeSession(session: StoredAuthSession | null): HandoverSession | null {
  if (!session) return null;
  const roles = Array.isArray(session.roles)
    ? session.roles.filter((role): role is string => typeof role === 'string')
    : [];
  const units = Array.isArray(session.units)
    ? session.units.filter((unit): unit is string => typeof unit === 'string')
    : [];
  const mode = session.mode === 'demo' ? 'demo' : undefined;
  const user: HandoverUser = {
    id: session.userId,
    userId: session.userId,
    displayName: session.displayName ?? session.fullName ?? session.userId,
    fullName: session.fullName,
    name: session.displayName ?? session.fullName,
    roles,
    units,
  };
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: normalizeExpiresAt(session.expiresAt),
    userId: session.userId,
    displayName: session.displayName ?? session.fullName ?? session.userId,
    email: session.email,
    picture: session.picture,
    idToken: session.idToken,
    roles,
    units,
    user,
    mode,
  };
}

async function migrateFromAsyncStorage(): Promise<HandoverSession | null> {
  if (migrationAttempted) return null;
  migrationAttempted = true;
  const legacy = await getLegacyAsyncStorage();
  if (!legacy) return null;
  const raw = await legacy.getItem(SESSION_KEY).catch(() => null);
  if (!raw) return null;
  await secureSetItem(SESSION_KEY, raw);
  await legacy.removeItem(SESSION_KEY).catch(() => {});
  return normalizeSession(parseSession(raw));
}

let hydrated = false;
let currentSession: HandoverSession | null = null;
let hydrateInFlight: Promise<HandoverSession | null> | null = null;
const listeners: Array<(session: HandoverSession | null) => void> = [];
let logoutInFlight: Promise<void> | null = null;
let pendingLogoutMessage: string | undefined;

function notify(session: SessionModel | null) {
  listeners.forEach((listener) => {
    try {
      listener(session);
    } catch {
      /* noop */
    }
  });
}

async function persistSession(session: HandoverSession | null): Promise<void> {
  if (!session) {
    await secureDeleteItem(SESSION_KEY);
    return;
  }
  const normalized: StoredAuthSession = {
    ...session,
    displayName: session.displayName ?? session.userId,
    roles: session.roles ?? [],
    units: session.units ?? [],
    expiresAt: normalizeExpiresAt(session.expiresAt),
    mode: session.mode === 'demo' ? 'demo' : undefined,
  };
  await secureSetItem(SESSION_KEY, JSON.stringify(normalized));
}

async function hydrateSession(): Promise<HandoverSession | null> {
  if (hydrated) return currentSession;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    try {
      try {
        const persisted = (await secureGetItem(SESSION_KEY)) ?? null;
        if (persisted) {
          currentSession = normalizeSession(parseSession(persisted));
          return currentSession;
        }
      } catch (error) {
        if (isDev) console.warn('[auth] Failed to read persisted session', error);
      }

      try {
        currentSession = await migrateFromAsyncStorage();
        if (currentSession) {
          await persistSession(currentSession);
        }
      } catch (error) {
        if (isDev) console.warn('[auth] Failed to migrate session', error);
        currentSession = null;
      }

      return currentSession;
    } finally {
      hydrated = true;
      hydrateInFlight = null;
    }
  })();

  return hydrateInFlight;
}

async function setSession(session: HandoverSession | null): Promise<void> {
  currentSession = session ? normalizeSession({ ...session }) : null;
  await persistSession(currentSession);
  notify(currentSession);
}

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
      // ignore
    }
  }

  return null;
}

function extractRoles(profile: Record<string, unknown>): UserRole[] {
  const rawRoles = (profile['roles'] ?? profile['app_metadata']) as unknown;
  const roles: string[] = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === 'string')
    : [];
  const allowed: UserRole[] = [];
  roles.forEach((role) => {
    if (role === 'nurse' || role === 'supervisor' || role === 'admin') {
      allowed.push(role as UserRole);
    }
  });
  return allowed.length ? allowed : ['nurse'];
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

function buildAuthConfig(config?: Partial<typeof DEFAULT_AUTH_CONFIG>) {
  return {
    issuer: config?.issuer ?? DEFAULT_AUTH_CONFIG.issuer,
    clientId: config?.clientId ?? DEFAULT_AUTH_CONFIG.clientId,
    redirectUri: config?.redirectUri ?? DEFAULT_AUTH_CONFIG.redirectUri,
    logoutUri: config?.logoutUri ?? DEFAULT_AUTH_CONFIG.logoutUri,
    scopes: config?.scopes ?? DEFAULT_AUTH_CONFIG.scopes,
  };
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
    idToken: (tokenResult as unknown as { id_token?: string; idToken?: string }).id_token ?? tokenResult.idToken,
    issuedAt: tokenResult.issuedAt ?? undefined,
    expiresIn: tokenResult.expiresIn ?? undefined,
    tokenType: tokenResult.tokenType ?? undefined,
  };
}

async function buildSessionFromTokens(tokens: AuthTokens, discovery: AuthSession.DiscoveryDocument | null) {
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
  const expiresAt = tokens.expiresAt ? normalizeExpiresAt(tokens.expiresAt) : normalizeExpiresAt(issuedAt + expiresIn);

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

export function isAuthCancelledError(error: unknown): boolean {
  if (!error) return false;
  const message = (error as { message?: string }).message ?? String(error);
  return message.includes('OAUTH_CANCELLED') || (error as { type?: string }).type === 'dismiss';
}

async function performAuth0Login(options: {
  config?: Partial<typeof DEFAULT_AUTH_CONFIG>;
  promptAsync: (options?: AuthSession.AuthRequestPromptOptions) => Promise<AuthSession.AuthSessionResult>;
  discovery?: AuthSession.DiscoveryDocument | null;
  request: AuthSession.AuthRequest;
}): Promise<HandoverSession> {
  if (AUTH_DISABLED) {
    // Creamos una sesión real local, sin modo demo
    return login({
      user: {
        id: 'nurse001',
        name: 'Luis Enfermero',
        roles: ['nurse'],
        units: ['UCI'],
      },
      accessToken: 'local-dev-token',
    });
  }
  const config = buildAuthConfig(options.config);
  const discovery = options.discovery ?? (await AuthSession.fetchDiscoveryAsync(config.issuer));
    
  const authResult = await options.promptAsync();

if (isDev) {
  warnAuth('AUTH_LOGIN_RESULT', { type: authResult.type });
  console.log('[auth] Auth result type:', authResult.type);
  console.log('[auth] Using redirectUri:', config.redirectUri);
}

  const tokens = await resolveTokensFromResult({
    request: options.request,
    result: authResult,
    discovery,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
  });
  const session = await buildSessionFromTokens(tokens, discovery);
  await setSession(session);
  return session;
}

export async function loginWithOAuth(config?: Partial<typeof DEFAULT_AUTH_CONFIG>): Promise<SessionModel> {
  const merged = buildAuthConfig(config);
  const discovery = await AuthSession.fetchDiscoveryAsync(merged.issuer);
  const request = new AuthSession.AuthRequest({
    clientId: merged.clientId,
    redirectUri: merged.redirectUri,
    scopes: merged.scopes,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });

  const session = await performAuth0Login({
    config: merged,
    discovery,
    promptAsync: (options) => request.promptAsync(discovery, options),
    request,
  });
  return session;
}

// BEGIN HANDOVER: AUTH_DEMO_LOGIN
export async function loginDemo(): Promise<SessionModel> {
  try {
    const session = ensureDemoSessionTemplate() ?? {
      accessToken: 'demo-token',
      refreshToken: undefined,
      expiresAt: normalizeExpiresAt(Math.floor(Date.now() / 1000) + 3600),
      userId: 'demo-user',
      displayName: 'Demo User',
      roles: ['nurse'],
      units: ['UCI', 'Pediatría'],
      mode: 'demo',
    };

    await setSession(session);
    return session;
  } catch (error) {
    if (isDev) console.warn('[demo] Failed to start demo session', error);

    const fallbackSession: SessionModel = {
      accessToken: 'demo-fallback-token',
      refreshToken: undefined,
      expiresAt: normalizeExpiresAt(Math.floor(Date.now() / 1000) + 3600),
      userId: 'demo-user',
      displayName: 'Demo User',
      roles: ['nurse'],
      units: [],
      mode: 'demo',
    };

    await setSession(fallbackSession);
    return fallbackSession;
  }
}
// END HANDOVER: AUTH_DEMO_LOGIN

// BEGIN HANDOVER: AUTH_LOGOUT
export async function logout(): Promise<void> {
  const message = pendingLogoutMessage;
  if (logoutInFlight) return logoutInFlight;

  const runner = async () => {
    await hydrateSession();
    const config = buildAuthConfig();
    const domain = AUTH0_DOMAIN;

    try {
      const authUrl = `https://${domain}/v2/logout?client_id=${config.clientId}&returnTo=${encodeURIComponent(
        config.logoutUri,
      )}`;
      await WebBrowser.openAuthSessionAsync(authUrl, config.logoutUri);
    } catch (error) {
      if (isDev) console.warn('[auth] Failed to complete logout', error);
    }

    await setSession(null);
    if (message) {
      Alert.alert('Sesión expirada', message);
    }
    navigation.resetTo('Login');
  };

  logoutInFlight = runner().finally(() => {
    logoutInFlight = null;
    pendingLogoutMessage = undefined;
  });

  return logoutInFlight;
}
export async function logoutAndClear(options: LogoutOptions = {}): Promise<void> {
  if (options.message) pendingLogoutMessage = options.message;
  if (options.skipRemote) {
    if (logoutInFlight) return logoutInFlight;
    logoutInFlight = (async () => {
      await setSession(null);
      if (options.message) Alert.alert('Sesión expirada', options.message);
      navigation.resetTo('Login');
    })().finally(() => {
      logoutInFlight = null;
      pendingLogoutMessage = undefined;
    });
    return logoutInFlight;
  }
  return logout();
}
// END HANDOVER: AUTH_LOGOUT

export async function getCurrentSession(): Promise<SessionModel | null> {
  if (!hydrated) {
    try {
      await hydrateSession();
    } catch (error) {
      if (isDev) console.warn('[auth] Failed to hydrate current session', error);
    }
  }
  return currentSession;
}

/**
 * Retorna un access token vigente. Si el access token está expirado (o por expirar),
 * intenta refrescarlo mediante refresh_token (OIDC).
 *
 * - Implementa "single-flight": múltiples llamadas concurrentes comparten 1 solo refresh.
 * - Nunca loguea tokens.
 */
// (refreshInFlight se declara una sola vez a nivel de módulo, cerca del inicio)

export async function ensureFreshToken(_audience?: string): Promise<string | null> {
  // IMPORTANTE: si tu módulo usa hidratación cacheada, asegúrate de que aquí
  // se lea el storage al menos una vez. Si ya lo haces dentro de getCurrentSession(), ok.
  const session = await getCurrentSession();
  if (!session?.accessToken) return null;

  const accessToken = session.accessToken;

  // Si no hay expiresAt o es inválido => tratamos como "expiring" (fuerza refresh si hay refreshToken)
  const expiresAtMs = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  const isExpiring =
    !Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() <= REFRESH_SKEW_MS;

  if (!isExpiring) return accessToken;

  // Asegura refreshToken en variable local (narrowing estable para TS y closures)
  const refreshToken = session.refreshToken;
  if (!refreshToken) return accessToken;

  // Single-flight
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      warnAuth('AUTH_REFRESH_START');

      const config = buildAuthConfig();
      const discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);

      const tokenEndpoint = discovery?.tokenEndpoint;
      if (!tokenEndpoint) {
        warnAuth('AUTH_REFRESH_NO_TOKEN_ENDPOINT');
        return accessToken;
      }

      const body = new URLSearchParams();
      body.set('grant_type', 'refresh_token');
      body.set('client_id', config.clientId);
      body.set('refresh_token', refreshToken);

      // opcional: si tu backend requiere scope en refresh
      if (config.scopes?.length) body.set('scope', config.scopes.join(' '));

      const resp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!resp.ok) {
        warnAuth('AUTH_REFRESH_FAILED', { status: resp.status });
        return accessToken;
      }

      const data = (await resp.json()) as Record<string, unknown>;

      const newAccess =
        (data['access_token'] as string | undefined) ??
        (data['accessToken'] as string | undefined);

      const newRefresh =
        (data['refresh_token'] as string | undefined) ??
        (data['refreshToken'] as string | undefined) ??
        refreshToken;

      const expiresInRaw = data['expires_in'] ?? data['expiresIn'];
      const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);

      const nextExpiresAt = Number.isFinite(expiresIn)
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : session.expiresAt;

      const nextSession: HandoverSession = {
        ...session,
        accessToken: newAccess ?? accessToken,
        refreshToken: newRefresh,
        expiresAt: nextExpiresAt,
      };

      await setSession(nextSession);
      warnAuth('AUTH_REFRESH_SUCCESS');

      return nextSession.accessToken ?? null;
    } catch (error) {
      warnAuth('AUTH_REFRESH_ERROR', { message: (error as any)?.message });
      return accessToken;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function setCurrentSession(session: SessionModel | null): Promise<void> {
  await setSession(session);
}

export const getSession = getCurrentSession;
export type Session = SessionModel;

export function onAuthChange(listener: (session: SessionModel | null) => void): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };
}

export function withAuthHeaders(init: { headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (currentSession?.accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${currentSession.accessToken}`;
  }
  return headers;
}

export async function login(params: {
  user: { id: string; name?: string; roles?: UserRole[]; units?: string[] };
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}): Promise<SessionModel> {
  const session: SessionModel = {
    accessToken: params.accessToken ?? 'dev-token',
    refreshToken: params.refreshToken,
    expiresAt: normalizeExpiresAt(params.expiresAt ?? Math.floor(Date.now() / 1000) + 3600),
    userId: params.user.id,
    displayName: params.user.name ?? 'Demo User',
    roles: params.user.roles ?? ['nurse'],
    units: params.user.units ?? [],
  };
  await setSession(session);
  return session;
}

interface AuthContextValue {
  session: SessionModel | null;
  loading: boolean;
  loginWithOAuth: (config?: Partial<typeof DEFAULT_AUTH_CONFIG>) => Promise<SessionModel>;
  loginDemo: () => Promise<SessionModel>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<SessionModel | null>(null);
  const [loading, setLoading] = useState(true);
  const authConfig = useMemo(() => buildAuthConfig(), []);
  const discovery = AuthSession.useAutoDiscovery(authConfig.issuer);
  const [authRequest, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: authConfig.clientId,
      redirectUri: authConfig.redirectUri,
      scopes: authConfig.scopes,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery,
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hydratedSession = await getCurrentSession();
        if (!mounted) return;
        setSessionState(hydratedSession);
      } catch (error) {
        if (isDev) console.warn('[auth] Failed to hydrate session', error);
        if (!mounted) return;
        setSessionState(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    const unsubscribe = onAuthChange((next) => {
      setSessionState(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    configureFHIRClient({
        ensureFreshToken: () => ensureFreshToken('fhir'),
      logout: async () =>
        logoutAndClear({
          skipRemote: true,
          message: 'Sesión expirada, inicia sesión de nuevo',
        }),
    });
  }, []);

    const loginWithAuth0 = useCallback(async () => {
      if (!authRequest) {
        throw new Error('AUTH_REQUEST_NOT_READY');
      }
      return performAuth0Login({
        config: authConfig,
        discovery,
        promptAsync: (options) => promptAsync(options),
        request: authRequest,
      });
    }, [authConfig, authRequest, discovery, promptAsync]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    loginWithOAuth: loginWithAuth0,
    loginDemo,
    logout,
  }), [session, loading, loginWithAuth0]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
// END HANDOVER_AUTH
