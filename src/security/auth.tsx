// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Buffer } from 'buffer';

import { ensureDemoSessionTemplate } from '@/src/demo/fixtures';
import type { AuthSession as StoredAuthSession, HandoverSession, UserRole } from './auth-types';
import { secureDeleteItem, secureGetItem, secureSetItem } from './secure-storage';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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
  AuthSession.makeRedirectUri({ useProxy: false, path: 'auth/logout' });

const DEFAULT_AUTH_CONFIG = {
  issuer: `https://${AUTH0_DOMAIN}`,
  clientId: AUTH0_CLIENT_ID,
  redirectUri: REDIRECT_URI,
  logoutUri: LOGOUT_REDIRECT_URI,
  scopes: ['openid', 'profile', 'email'],
};
// END HANDOVER: AUTH_CONFIG

type SessionModel = HandoverSession;

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
    const storage = (mod as unknown as { default?: AsyncStorageLike }).default ?? (mod as unknown as AsyncStorageLike);
    if (storage?.getItem && storage?.removeItem) return storage;
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

function normalizeExpiresAt(expiresAt: StoredAuthSession['expiresAt']): string | undefined {
  if (typeof expiresAt === 'number') {
    return new Date(expiresAt * 1000).toISOString();
  }
  if (!expiresAt) return undefined;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
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
const listeners: Array<(session: HandoverSession | null) => void> = [];

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
  hydrated = true;
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

async function resolveTokensFromResult(
  result: AuthSession.AuthSessionResult,
  discovery: AuthSession.DiscoveryDocument | null,
  clientId: string,
  redirectUri: string,
  codeVerifier?: string | null,
): Promise<AuthTokens> {
  if (result.type !== 'success') {
    throw new Error(result.params?.error_description ?? 'OAUTH_CANCELLED');
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

  const params = result.params as Record<string, string | undefined>;
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

  const tokenResult = await AuthSession.exchangeCodeAsync(
    { clientId, code, redirectUri, extraParams: codeVerifier ? { code_verifier: codeVerifier } : undefined },
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

  const userInfo = await fetchUserInfo(discovery?.userinfoEndpoint ?? discovery?.userInfoEndpoint, tokens.accessToken);
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

async function performAuth0Login(options: {
  config?: Partial<typeof DEFAULT_AUTH_CONFIG>;
  promptAsync: (options?: AuthSession.AuthRequestPromptOptions) => Promise<AuthSession.AuthSessionResult>;
  discovery?: AuthSession.DiscoveryDocument | null;
  codeVerifier?: string | null;
}): Promise<HandoverSession> {
  if (process.env.EXPO_PUBLIC_AUTH_DISABLED === 'true') {
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

  const authResult = await options.promptAsync({ useProxy: false });

  if (isDev) {
    console.log('[auth] Auth result type:', authResult.type);
    console.log('[auth] Auth result params:', authResult.params);
    console.log('[auth] Using redirectUri:', config.redirectUri);
  }

  const tokens = await resolveTokensFromResult(
    authResult,
    discovery,
    config.clientId,
    config.redirectUri,
    options.codeVerifier,
  );
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
    promptAsync: (options) => request.promptAsync(discovery, { ...options, useProxy: false }),
    codeVerifier: request.codeVerifier,
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

  const loginWithAuth0 = useCallback(async () => {
    return performAuth0Login({
      config: authConfig,
      discovery,
      promptAsync: (options) => promptAsync({ ...options, useProxy: false }),
      codeVerifier: authRequest?.codeVerifier,
    });
  }, [authConfig, authRequest?.codeVerifier, discovery, promptAsync]);

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
