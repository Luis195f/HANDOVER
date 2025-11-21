// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { AuthSession, HandoverSession, UserRole } from './auth-types';
import { secureDeleteItem, secureGetItem, secureSetItem } from './secure-storage';

WebBrowser.maybeCompleteAuthSession();

const DEFAULT_AUTH_CONFIG = {
  issuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://example.auth0.com',
  clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? 'handover-mobile',
  scopes: (process.env.EXPO_PUBLIC_OIDC_SCOPES ?? 'openid profile email offline_access').split(' '),
};

type SessionModel = HandoverSession;

const SESSION_KEY = `${process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover'}:auth-session`;
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

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function normalizeExpiresAt(expiresAt: AuthSession['expiresAt']): string | undefined {
  if (typeof expiresAt === 'number') {
    return new Date(expiresAt * 1000).toISOString();
  }
  if (!expiresAt) return undefined;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeSession(session: AuthSession | null): HandoverSession | null {
  if (!session) return null;
  const roles = Array.isArray(session.roles)
    ? session.roles.filter((role): role is string => typeof role === 'string')
    : [];
  const units = Array.isArray(session.units)
    ? session.units.filter((unit): unit is string => typeof unit === 'string')
    : [];
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: normalizeExpiresAt(session.expiresAt),
    userId: session.userId,
    displayName: session.displayName ?? session.fullName ?? session.userId,
    roles,
    units,
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
  const normalized: AuthSession = {
    ...session,
    displayName: session.displayName ?? session.userId,
    roles: session.roles ?? [],
    units: session.units ?? [],
    expiresAt: normalizeExpiresAt(session.expiresAt),
  };
  await secureSetItem(SESSION_KEY, JSON.stringify(normalized));
}

async function hydrateSession(): Promise<HandoverSession | null> {
  if (hydrated) return currentSession;
  hydrated = true;
  const persisted = (await secureGetItem(SESSION_KEY)) ?? null;
  if (persisted) {
    currentSession = normalizeSession(parseSession(persisted));
    return currentSession;
  }

  currentSession = await migrateFromAsyncStorage();
  if (currentSession) {
    await persistSession(currentSession);
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

function extractRoles(profile: Record<string, unknown>): UserRole[] {
  const rawRoles = (profile['roles'] ?? profile['app_metadata']) as unknown;
  const roles: string[] = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === 'string')
    : [];
  const allowed: UserRole[] = [];
  roles.forEach((role) => {
    if (role === 'nurse' || role === 'supervisor') {
      allowed.push(role);
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

async function performOAuth(config?: Partial<typeof DEFAULT_AUTH_CONFIG>): Promise<HandoverSession> {
  const issuer = config?.issuer ?? DEFAULT_AUTH_CONFIG.issuer;
  const clientId = config?.clientId ?? DEFAULT_AUTH_CONFIG.clientId;
  const scopes = config?.scopes ?? DEFAULT_AUTH_CONFIG.scopes;
  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
  const discovery = await AuthSession.fetchDiscoveryAsync(issuer);

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });

  const result = await request.promptAsync(discovery, { useProxy: true });
  if (result.type !== 'success' || !result.authentication?.accessToken) {
    throw new Error(result.params?.error_description ?? 'OAUTH_CANCELLED');
  }

  const { accessToken, refreshToken, issuedAt, expiresIn } = result.authentication;
  const expiresAtSeconds = issuedAt && expiresIn ? issuedAt + expiresIn : Math.floor(Date.now() / 1000) + 3600;
  const expiresAt = normalizeExpiresAt(expiresAtSeconds);

  const profile = (await fetchUserInfo(discovery.userInfoEndpoint, accessToken)) ?? {};
  const roles = extractRoles(profile);
  const units = extractUnits(profile);
  const userId = (profile['sub'] as string | undefined) ?? 'unknown-user';
  const displayName =
    (profile['name'] as string | undefined) ?? (profile['preferred_username'] as string | undefined) ?? 'Unknown';

  return {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt,
    userId,
    displayName,
    roles,
    units,
  };
}

export async function loginWithOAuth(config?: Partial<typeof DEFAULT_AUTH_CONFIG>): Promise<SessionModel> {
  const session = await performOAuth(config);
  await setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  await hydrateSession();
  await setSession(null);
}

export async function getCurrentSession(): Promise<SessionModel | null> {
  if (!hydrated) {
    await hydrateSession();
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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<SessionModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hydratedSession = await getCurrentSession();
      if (!mounted) return;
      setSessionState(hydratedSession);
      setLoading(false);
    })();
    const unsubscribe = onAuthChange((next) => {
      setSessionState(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    loginWithOAuth,
    logout,
  }), [session, loading]);

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
