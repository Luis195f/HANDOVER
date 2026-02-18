// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Buffer } from 'buffer';
import { t } from '@/src/i18n';
import { isDemoAccessEnabled } from '@/src/security/demo-access';
import { ensureDemoSessionTemplate } from '@/src/demo/fixtures';
import type { AuthSession as StoredAuthSession, HandoverSession, HandoverUser, UserRole } from './auth-types';
import { getToken, registerTokenSupplier } from '@/src/security/tokenSupplier';
import { secureGetItem, secureSetItem, secureDeleteItem } from "@/src/security/secure-storage";
import AuthService, {
  createLocalAuthProvider,
  isTokenExpired,
  loginWithProvider,
  refreshWithProvider,
} from '@/src/security/AuthService';
import { resetTo } from "@/src/navigation/navigation"; 
import { configureFHIRClient } from '@/src/lib/fhir-client';
import { clearSensitiveLocalData } from '@/src/security/secure-cleanup';
import {
  AUTH_DISABLED,
  buildAuthConfig,
  buildExtraParams,
  clearStoredSession,
  loadStoredSession,
  loginWithOAuth as oauthLogin,
  refreshTokens as refreshOAuthTokens,
  storeSession as storeOAuthSession,
} from '@/src/security/OAuthService';
import type { OAuthConfig } from '@/src/security/OAuthService';



type CapabilityPermissions = {
  canWriteHandover: boolean;
  canSignHandover: boolean;
  canViewAudit: boolean;
  canSendAuditEvents: boolean;
  isAdmin: boolean;
};

type FhirProfile = {
  canonical: string;
  version?: string;
  title?: string;
};

type FhirCapabilities = {
  version: string;
  transaction: boolean;
  profiles: FhirProfile[];
};

type Capabilities = {
  userSub: string;
  roles: string[];
  scopes: string[];
  permissions: CapabilityPermissions;
  fhir?: FhirCapabilities;
};

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
  | 'AUTH_REFRESH_SKIP'
  | 'AUTH_REFRESH_NO_TOKEN_ENDPOINT'
  | 'AUTH_REFRESH_ERROR'
  | 'AUTH_REQUEST_NOT_READY';

/**
 * Logger de eventos de autenticación (solo en DEV).
 * Importante: no loguear PHI ni secretos (tokens, auth headers, emails, etc.).
 */
function sanitizeNamespace(nsRaw: string): string {
  const ns = (nsRaw ?? "").replace(/[^\w.-]/g, "");
  return ns || "handover";
}

export function getAuthSessionStorageKey(): string {
  const ns = sanitizeNamespace(process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? "handover");
  return `${ns}_auth_session`;
}

// Export estable para tests (si quieres)
export const AUTH_SESSION_STORAGE_KEY = getAuthSessionStorageKey();
function warnAuth(_code: AuthWarnCode, _meta: Record<string, unknown> = {}): void {}

let refreshInFlight: Promise<HandoverSession | null> | null = null;
const REFRESH_SKEW_MS = 300_000;
const NO_ROLE = 'NO_ROLE';


try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
}

type SessionModel = HandoverSession;

type LogoutOptions = {
  skipRemote?: boolean;
  message?: string;
};

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

function getJwtExpiresAtMs(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded) as { exp?: number };
    if (!claims.exp) return null;
    return claims.exp * 1000;
  } catch {
    return null;
  }
}

function resolveSessionExpiryMs(session: HandoverSession | null): number | null {
  if (!session) return null;
  if (session.expiresAt) {
    const parsed = Date.parse(session.expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return getJwtExpiresAtMs(session.accessToken);
}

function normalizeExpiresAt(expiresAt: string | number | undefined): string | undefined {
  return toIsoExpiresAt(expiresAt);
}

function normalizeSession(session: StoredAuthSession | null): HandoverSession | null {
  if (!session) return null;
  const normalizedRoles = Array.isArray(session.roles)
    ? session.roles.filter((role): role is string => typeof role === 'string')
    : [];
  const roles = normalizedRoles.length > 0 ? normalizedRoles : [NO_ROLE];
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

async function ensureSessionValid(session: HandoverSession | null): Promise<HandoverSession | null> {
  if (!session) return null;
  const expiresAtMs = resolveSessionExpiryMs(session);
  if (expiresAtMs && expiresAtMs > Date.now()) return session;

  if (session.refreshToken) {
    if (isLocalSession(session)) {
      try {
        const refreshed = await refreshWithProvider(createLocalAuthProvider(), session.refreshToken);
        const nextSession: HandoverSession = {
          ...session,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? session.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
        await setSession(nextSession);
        return nextSession;
      } catch {
        await logoutAndClear({
          skipRemote: true,
          message: t('auth.sessionExpiredMessage'),
        });
        return null;
      }
    }

    const refreshed = await refreshOAuthTokens(session.refreshToken);
    if (refreshed) {
      const nextSession: HandoverSession = {
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? session.refreshToken,
        expiresAt: refreshed.expiresAt ?? session.expiresAt,
      };
      await setSession(nextSession);
      return nextSession;
    }
  }

  await logoutAndClear({
    skipRemote: true,
    message: t('auth.sessionExpiredMessage'),
  });
  return null;
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

function toAuthTokens(session: HandoverSession): { accessToken: string; refreshToken?: string; expiresAt: string } | null {
  if (!session.accessToken || !session.expiresAt) return null;
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}

function isLocalSession(session: HandoverSession): boolean {
  return Boolean(session.refreshToken?.startsWith('local-refresh-') || session.accessToken?.startsWith('local-'));
}

async function persistSession(session: HandoverSession | null): Promise<void> {
  if (!session) {
    await clearStoredSession();
    return;
  }
  const normalized: StoredAuthSession = {
    ...session,
    displayName: session.displayName ?? session.userId,
    roles: Array.isArray(session.roles) ? session.roles : [],
    units: session.units ?? [],
    expiresAt: normalizeExpiresAt(session.expiresAt),
    mode: session.mode === 'demo' ? 'demo' : undefined,
  };
  await storeOAuthSession(normalized);
}

async function persistTokens(session: HandoverSession | null): Promise<void> {
  if (!session) {
    await AuthService.clearTokens();
    return;
  }
  const tokens = toAuthTokens(session);
  if (tokens) {
    await AuthService.storeTokens(tokens);
  }
}

async function hydrateSession(): Promise<HandoverSession | null> {
  if (hydrated) return currentSession;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    try {
      try {
        const persisted = await loadStoredSession();
        if (persisted) {
          currentSession = normalizeSession(persisted);
          if (currentSession) {
            await persistTokens(currentSession);
            const refreshed = await ensureSessionValid(currentSession);
            currentSession = refreshed;
          }
          return currentSession;
        }
      } catch {
      }

      if (!currentSession) {
        const storedTokens = await AuthService.loadTokens();
        if (storedTokens && !isTokenExpired(storedTokens)) {
          currentSession = normalizeSession({
            accessToken: storedTokens.accessToken,
            refreshToken: storedTokens.refreshToken ?? undefined,
            expiresAt: storedTokens.expiresAt,
            userId: 'local-user',
            displayName: 'Usuario',
            roles: [NO_ROLE],
            units: [],
          });
        } else if (storedTokens?.refreshToken) {
          try {
            const isLocalRefresh = storedTokens.refreshToken.startsWith('local-refresh-');
            const refreshedTokens = isLocalRefresh
              ? await refreshWithProvider(createLocalAuthProvider(), storedTokens.refreshToken)
              : await AuthService.refresh(storedTokens.refreshToken);
            currentSession = normalizeSession({
              accessToken: refreshedTokens.accessToken,
              refreshToken: storedTokens.refreshToken ?? undefined,
              expiresAt: refreshedTokens.expiresAt,
              userId: 'local-user',
              displayName: 'Usuario',
              roles: [NO_ROLE],
              units: [],
            });
          } catch {
            await AuthService.clearTokens();
            currentSession = null;
          }
        }
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
  await persistTokens(currentSession);
  notify(currentSession);
}

export function isAuthCancelledError(error: unknown): boolean {
  if (!error) return false;
  const message = (error as { message?: string }).message ?? String(error);
  const type = (error as { type?: string }).type;
  return message.includes('OAUTH_CANCELLED') || type === 'dismiss' || type === 'cancel';
}

async function performAuth0Login(options: {
  config?: Partial<OAuthConfig>;
  promptAsync: (options?: AuthSession.AuthRequestPromptOptions) => Promise<AuthSession.AuthSessionResult>;
  discovery?: AuthSession.DiscoveryDocument | null;
  request: AuthSession.AuthRequest;
}): Promise<HandoverSession> {
  if (AUTH_DISABLED) {
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

  // Debug fuerte: si esto no calza con Auth0 Allowed Callback URLs, se rompe el flujo.
  if (__DEV__) {
    try {
      console.info('[auth] performAuth0Login config', {
        issuer: options.config?.issuer,
        clientId: options.config?.clientId,
        redirectUri: options.config?.redirectUri,
        logoutUri: options.config?.logoutUri,
        scopes: options.config?.scopes,
        hasAudience: Boolean((options.config as any)?.audience),
      });
    } catch {
      // no-op
    }
  }

  try {
    const session = await oauthLogin({
      config: options.config,
      discovery: options.discovery,
      promptAsync: options.promptAsync,
      request: options.request,
    });

    await setSession(session);
    return session;
  } catch (error) {
    // Si el usuario cierra / cancela, no “rompas” el flujo.
    // Deja que el caller decida si alerta o no, pero evita estados inconsistentes.
    if (__DEV__) {
      console.warn('[auth] performAuth0Login failed', error);
    }
    throw error;
  }
}

export async function loginWithOAuth(
  config?: Partial<OAuthConfig>,
): Promise<SessionModel> {
  const merged = buildAuthConfig(config);

  if (__DEV__) {
    try {
      console.info('[auth] loginWithOAuth merged', {
        issuer: merged.issuer,
        clientId: merged.clientId,
        redirectUri: merged.redirectUri,
        logoutUri: merged.logoutUri,
        scopes: merged.scopes,
        hasAudience: Boolean((merged as any)?.audience),
      });
    } catch {
      // no-op
    }
  }

  const discovery = await AuthSession.fetchDiscoveryAsync(merged.issuer);

  const request = new AuthSession.AuthRequest({
    clientId: merged.clientId,
    redirectUri: merged.redirectUri,
    scopes: merged.scopes,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
    extraParams: buildExtraParams((merged as any).audience),
  });

  return performAuth0Login({
    config: merged,
    discovery,
    // IMPORTANTE: En móvil (EAS dev build), esto debe devolver a tu app por deep link.
    // preferEphemeralSession ayuda a evitar cookies “pegadas” en iOS; no rompe Android.
    promptAsync: (options) =>
      request.promptAsync(discovery, {
        useProxy: false,
        preferEphemeralSession: true,
        ...(options ?? {}),
      }),
    request,
  });
}

// BEGIN HANDOVER: AUTH_DEMO_LOGIN
export async function loginDemo(): Promise<SessionModel> {
  if (!isDemoAccessEnabled()) {
    throw new Error('DEMO_DISABLED');
  }

  try {
    const session = ensureDemoSessionTemplate() ?? {
      accessToken: 'demo-token',
      refreshToken: undefined,
      expiresAt: normalizeExpiresAt(Math.floor(Date.now() / 1000) + 3600),
      userId: 'demo-user',
      displayName: 'Demo User',
      roles: ["nurse"],
      units: ['UCI', 'Pediatría'],
      mode: 'demo',
    };

    await setSession(session);
    return session;
  } catch {

    const fallbackSession: SessionModel = {
      accessToken: 'demo-fallback-token',
      refreshToken: undefined,
      expiresAt: normalizeExpiresAt(Math.floor(Date.now() / 1000) + 3600),
      userId: 'demo-user',
      displayName: 'Demo User',
      roles: ["admin"],
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
    const issuerOrigin = (() => {
      try {
        return new URL(config.issuer).origin;
      } catch {
        return config.issuer;
      }
    })();

    if (__DEV__) {
      try {
        console.info('[auth] logout config', {
          issuer: config.issuer,
          issuerOrigin,
          clientId: config.clientId,
          logoutUri: config.logoutUri,
        });
      } catch {
        // no-op
      }
    }

    try {
      const authUrl =
        `${issuerOrigin}/v2/logout?client_id=${encodeURIComponent(config.clientId)}` +
        `&returnTo=${encodeURIComponent(config.logoutUri)}`;

      // Si el deep link de logout no está registrado, esto puede fallar/silenciarse.
      await WebBrowser.openAuthSessionAsync(authUrl, config.logoutUri);
    } catch (error) {
      if (__DEV__) {
        console.warn('[auth] logout openAuthSessionAsync failed', error);
      }
      // seguimos igual: limpiamos local y reseteamos navegación
    }

    await setSession(null);
    await clearSensitiveLocalData();

    if (message) {
      Alert.alert(t('auth.sessionExpiredTitle'), message);
    }

    resetTo('Login');
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
      await clearSensitiveLocalData();

      if (options.message) {
        Alert.alert(t('auth.sessionExpiredTitle'), options.message);
      }

      resetTo('Login');
    })().finally(() => {
      logoutInFlight = null;
      pendingLogoutMessage = undefined;
    });

    return logoutInFlight;
  }

  return logout();
}
// END HANDOVER: AUTH_LOGOUT

async function getHydratedSession(): Promise<SessionModel | null> {
  if (!hydrated) {
    try {
      await hydrateSession();
    } catch {
    }
  }
  return currentSession;
}

export async function getCurrentSession(): Promise<SessionModel | null> {
  const session = await getHydratedSession();
  if (!session) return null;
  await ensureFreshToken();
  return currentSession;
}

// (refreshInFlight se declara una sola vez a nivel de módulo, cerca del inicio)

/**
 * Retorna un access token vigente. Si el access token está expirado (o por expirar),
 * intenta refrescarlo mediante refresh_token (OIDC).
 *
 * - Implementa "single-flight": múltiples llamadas concurrentes comparten 1 solo refresh.
 * - Nunca loguea tokens.
 * - Si audience === '401', fuerza refresh (útil tras un 401 real).
 */
export async function ensureFreshToken(audience?: string): Promise<string | null> {
  const session = await getHydratedSession();

  if (!session?.accessToken) {
    warnAuth('AUTH_REFRESH_SKIP', { reason: 'no-session' });
    return null;
  }

  const accessToken = session.accessToken;

  // Determinar si hay que refrescar (expiringSoon o forzado por "401")
  const forceRefresh = audience === '401';

  // Si REFRESH_SKEW_MS no está definido correctamente, fuerza a 60s por defecto
  const skewMs =
    typeof REFRESH_SKEW_MS === 'number' && REFRESH_SKEW_MS > 0 ? REFRESH_SKEW_MS : 60_000;

  const expiresAtMs = resolveSessionExpiryMs(session);
  const isExpiring = !expiresAtMs || expiresAtMs - Date.now() <= skewMs;

  if (!isExpiring && !forceRefresh) return accessToken;

  const refreshToken = session.refreshToken;
  if (!refreshToken) {
    warnAuth('AUTH_REFRESH_SKIP', { reason: 'no-refresh-token' });
    return accessToken;
  }

  // Single-flight
  if (refreshInFlight) {
    const inFlightSession = await refreshInFlight;
    return inFlightSession?.accessToken ?? accessToken;
  }

  refreshInFlight = (async () => {
    try {
      warnAuth('AUTH_REFRESH_START');

      const refreshed = await refreshOAuthTokens(refreshToken);
      if (!refreshed) {
        warnAuth('AUTH_REFRESH_NO_TOKEN_ENDPOINT');
        return session;
      }

      const nextSession: HandoverSession = {
        ...session,
        accessToken: refreshed.accessToken ?? accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        expiresAt: refreshed.expiresAt ?? session.expiresAt,
      };

      await setSession(nextSession);
      warnAuth('AUTH_REFRESH_SUCCESS');

      return nextSession;
    } catch {
      await logoutAndClear({
        skipRemote: true,
        message: t('auth.sessionExpiredMessage'),
      });
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  const refreshedSession = await refreshInFlight;
  return refreshedSession?.accessToken ?? null;
}

export async function ensureFreshAccessToken(service?: string): Promise<string | null> {
  const supplied = await getToken(service);
  return supplied ?? ensureFreshToken(service);
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
    roles: params.user.roles ?? [NO_ROLE],
    units: params.user.units ?? [],
  };
  await setSession(session);
  return session;
}


async function clearCapabilitiesCacheLazy(): Promise<void> {
  const { clearCapabilitiesCache } = await import('@/src/security/capabilities');
  await clearCapabilitiesCache();
}

async function fetchCapabilitiesLazy(options: { forceRefresh?: boolean; maxAgeMs?: number } = {}): Promise<Capabilities | null> {
  const { fetchCapabilities } = await import('@/src/security/capabilities');
  return fetchCapabilities(options);
}

async function getDemoCapabilitiesLazy(userSub?: string): Promise<Capabilities> {
  const { getDemoCapabilities } = await import('@/src/security/capabilities');
  return getDemoCapabilities(userSub);
}

interface AuthContextValue {
  session: SessionModel | null;
  capabilities: Capabilities | null;
  loading: boolean;
  loginWithOAuth: (config?: Partial<OAuthConfig>) => Promise<SessionModel>;
  loginWithCredentials: (params: { username: string; password: string }) => Promise<SessionModel>;
  loginDemo: () => Promise<SessionModel>;
  logout: () => Promise<void>;
  refreshCapabilities: () => Promise<Capabilities | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<SessionModel | null>(null);
  const [capabilities, setCapabilitiesState] = useState<Capabilities | null>(null);
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
      extraParams: buildExtraParams(authConfig.audience),
    },
    discovery,
  );

  const loginWithCredentials = useCallback(async (params: { username: string; password: string }) => {
    const result = await loginWithProvider(createLocalAuthProvider(), params);

    const nextSession: HandoverSession = {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken ?? undefined,
      expiresAt: result.tokens.expiresAt,
      userId: result.user.id,
      displayName: result.user.name ?? result.user.id,
      roles: result.user.roles ?? [NO_ROLE],
      units: result.user.units ?? [],
      user: {
        id: result.user.id,
        name: result.user.name ?? result.user.id,
        roles: result.user.roles ?? [NO_ROLE],
        units: result.user.units ?? [],
      },
    };

    await setSession(nextSession);
    return nextSession;
  }, []);

  // 1) Hidratar sesión + suscripción auth-change (una sola vez)
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const hydratedSession = await getCurrentSession();
        if (!mounted) return;
        setSessionState(hydratedSession);
      } catch {
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

  // 2) Token supplier (se actualiza cuando cambia la sesión)
  useEffect(() => {
    if (!session?.accessToken) {
      registerTokenSupplier(async () => null);
      return;
    }

    // Nota: supplier debe ser estable y “fresh”; ensureFreshToken ya debe leer sesión actual internamente
    registerTokenSupplier(async (service?: string) => ensureFreshToken(service ?? "fhir"));
  }, [session?.accessToken, session?.refreshToken, session?.expiresAt, session?.mode]);

  const previousUserIdRef = useRef<string | null>(null);

  // 3) Capabilities
  useEffect(() => {
    let alive = true;

    (async () => {
      const currentUserId = session?.userId ?? null;
      const previousUserId = previousUserIdRef.current;
      const userChanged = previousUserId !== null && previousUserId !== currentUserId;

      if (!session) {
        setCapabilitiesState(null);
        await clearCapabilitiesCacheLazy();
        previousUserIdRef.current = null;
        return;
      }

      if (userChanged) {
        await clearCapabilitiesCacheLazy();
      }

      previousUserIdRef.current = currentUserId;

      if (session.mode === "demo") {
        setCapabilitiesState(await getDemoCapabilitiesLazy(session.userId));
        return;
      }

      const caps = await fetchCapabilitiesLazy();
      if (alive) setCapabilitiesState(caps);
    })();

    return () => {
      alive = false;
    };
  }, [session]);

  // 4) Configuración FHIR client (una vez)
  useEffect(() => {
    configureFHIRClient({
      getToken: () => AuthService.getAccessToken(),
      ensureFreshToken: () => ensureFreshToken("fhir"),
      getSession: () => getCurrentSession(),
      logout: async () =>
        logoutAndClear({
          skipRemote: true,
          message: t("auth.sessionExpiredMessage"),
        }),
    });
  }, []);

  const loginWithAuth0 = useCallback(async () => {
    if (!authRequest) {
      throw new Error("AUTH_REQUEST_NOT_READY");
    }
    try {
      return await performAuth0Login({
        config: authConfig,
        discovery,
        promptAsync: (options) => promptAsync(options),
        request: authRequest,
      });
    } catch (error) {
      if (!isAuthCancelledError(error)) {
        Alert.alert(t("auth.invalidCredentialsTitle"), t("auth.invalidCredentialsMessage"));
      }
      throw error;
    }
  }, [authConfig, authRequest, discovery, promptAsync]);

  const refreshCapabilities = useCallback(async () => {
    if (!session) {
      setCapabilitiesState(null);
      return null;
    }
    if (session.mode === "demo") {
      const demoCaps = await getDemoCapabilitiesLazy(session.userId);
      setCapabilitiesState(demoCaps);
      return demoCaps;
    }
    const caps = await fetchCapabilitiesLazy({ forceRefresh: true });
    setCapabilitiesState(caps);
    return caps;
  }, [session]);

  // ✅ IMPORTANTE: incluye loginDemo/logout en deps (no rompe nada; evita bugs por closures)
  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      capabilities,
      loading,
      loginWithOAuth: loginWithAuth0,
      loginWithCredentials,
      loginDemo,
      logout,
      refreshCapabilities,
    }),
    [
      session,
      capabilities,
      loading,
      loginWithAuth0,
      loginWithCredentials,
      loginDemo,
      logout,
      refreshCapabilities,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
// END HANDOVER_AUTH

