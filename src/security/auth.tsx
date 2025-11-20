// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { AuthSession as SessionModel, UserRole } from './auth-types';

WebBrowser.maybeCompleteAuthSession();

const DEFAULT_AUTH_CONFIG = {
  issuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? 'https://example.auth0.com',
  clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? 'handover-mobile',
  scopes: (process.env.EXPO_PUBLIC_OIDC_SCOPES ?? 'openid profile email offline_access').split(' '),
};

const SESSION_KEY = `${process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover'}:auth-session`;

interface StorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const memoryStore = new Map<string, string>();

function makeMemoryStore(): StorageAdapter {
  return {
    async getItem(key) {
      return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
    },
    async setItem(key, value) {
      memoryStore.set(key, value);
    },
    async removeItem(key) {
      memoryStore.delete(key);
    },
  };
}

function makeSecureStore(): StorageAdapter | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-secure-store');
    const SecureStore = mod?.default ?? mod;
    if (!SecureStore?.getItemAsync) return null;
    return {
      async getItem(key) {
        try {
          return await SecureStore.getItemAsync(key);
        } catch {
          return null;
        }
      },
      async setItem(key, value) {
        try {
          await SecureStore.setItemAsync(key, value);
        } catch {}
      },
      async removeItem(key) {
        try {
          await SecureStore.deleteItemAsync(key);
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

function makeLocalStorageStore(): StorageAdapter | null {
  if (typeof localStorage === 'undefined') return null;
  return {
    async getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    async removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };
}

const storage: StorageAdapter = makeSecureStore() ?? makeLocalStorageStore() ?? makeMemoryStore();

let hydrated = false;
let currentSession: SessionModel | null = null;
const listeners: Array<(session: SessionModel | null) => void> = [];

function notify(session: SessionModel | null) {
  listeners.forEach((listener) => {
    try {
      listener(session);
    } catch {
      /* noop */
    }
  });
}

async function persistSession(session: SessionModel | null): Promise<void> {
  if (!session) {
    await storage.removeItem(SESSION_KEY);
    return;
  }
  await storage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function hydrateSession(): Promise<SessionModel | null> {
  if (hydrated) return currentSession;
  hydrated = true;
  const raw = await storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    currentSession = JSON.parse(raw) as SessionModel;
    return currentSession;
  } catch {
    return null;
  }
}

async function setSession(session: SessionModel | null): Promise<void> {
  currentSession = session;
  await persistSession(session);
  notify(session);
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

async function performOAuth(config?: Partial<typeof DEFAULT_AUTH_CONFIG>): Promise<SessionModel> {
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
  const expiresAt = issuedAt && expiresIn ? issuedAt + expiresIn : Math.floor(Date.now() / 1000) + 3600;

  const profile = (await fetchUserInfo(discovery.userInfoEndpoint, accessToken)) ?? {};
  const roles = extractRoles(profile);
  const units = extractUnits(profile);
  const userId = (profile['sub'] as string | undefined) ?? 'unknown-user';
  const fullName = (profile['name'] as string | undefined) ?? (profile['preferred_username'] as string | undefined) ?? 'Unknown';

  return {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt,
    userId,
    fullName,
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
    expiresAt: params.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
    userId: params.user.id,
    fullName: params.user.name ?? 'Demo User',
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
