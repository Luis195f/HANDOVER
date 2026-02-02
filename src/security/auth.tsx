// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { t } from '@/src/i18n';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import { ensureDemoSessionTemplate } from '@/src/demo/fixtures';
import type { AuthSession as StoredAuthSession, HandoverSession, HandoverUser, UserRole } from './auth-types';
import type { Capabilities } from '@/src/security/capabilities';
import { clearCapabilitiesCache, fetchCapabilities, getDemoCapabilities } from '@/src/security/capabilities';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';
import AuthService, { isTokenExpired } from '@/src/security/AuthService';
import { resetTo } from "@/src/navigation/navigation"; 
import { configureFHIRClient } from '@/src/lib/fhir-client';

const AUTH_DISABLED =
  (process.env.EXPO_PUBLIC_AUTH_DISABLED ?? '').trim().toLowerCase() === 'true';

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
function warnAuth(_code: AuthWarnCode, _meta: Record<string, unknown> = {}): void {}

let refreshInFlight: Promise<HandoverSession | null> | null = null;
const REFRESH_SKEW_MS = 60_000;
const NO_ROLE = 'NO_ROLE';


try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
}

// BEGIN HANDOVER: AUTH_CONFIG
const AUTH0_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? 'dev-6jmxxysflz2kx61w.us.auth0.com';

const AUTH0_CLIENT_ID =
  process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? 'zJxhI0SK1J4hmzr1KNzEbWddgZWJDUlL';

const OIDC_ISSUER =
  (process.env.EXPO_PUBLIC_OIDC_ISSUER ?? process.env.OIDC_ISSUER ?? `https://${AUTH0_DOMAIN}`).replace(/\/$/, '');

const OIDC_CLIENT_ID =
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? process.env.OIDC_CLIENT_ID ?? AUTH0_CLIENT_ID;

const RAW_OIDC_AUDIENCE =
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE ??
  process.env.OIDC_AUDIENCE ??
  process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ??
  '';

const OIDC_AUDIENCE = RAW_OIDC_AUDIENCE.trim() ? RAW_OIDC_AUDIENCE : undefined;

const OIDC_SCOPE =
  process.env.EXPO_PUBLIC_OIDC_SCOPE ?? process.env.OIDC_SCOPE ?? 'openid profile email';

const REDIRECT_PATH_WEB = '--/redirect';
const LOGOUT_PATH_WEB   = '--/logout';

const REDIRECT_PATH_NATIVE = 'redirect';
const LOGOUT_PATH_NATIVE   = 'logout';

// WEB: forzamos mismo ORIGIN real (evita localhost vs 127 vs 192.168.x.x)
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

async function refreshSessionWithOidc(session: HandoverSession): Promise<HandoverSession | null> {
  if (!session.refreshToken) return null;
  try {
    const config = buildAuthConfig();
    const discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);
    const tokenEndpoint = discovery?.tokenEndpoint;
    if (!tokenEndpoint) {
      return null;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('client_id', config.clientId);
    body.set('refresh_token', session.refreshToken);
    if (config.scopes?.length) body.set('scope', config.scopes.join(' '));

    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<string, unknown>;
    const newAccess =
      (data['access_token'] as string | undefined) ??
      (data['accessToken'] as string | undefined);
    if (!newAccess) return null;

    const newRefresh =
      (data['refresh_token'] as string | undefined) ??
      (data['refreshToken'] as string | undefined) ??
      session.refreshToken;

    const expiresInRaw = data['expires_in'] ?? data['expiresIn'];
    const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);
    const nextExpiresAt = Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : session.expiresAt;

    return {
      ...session,
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt: nextExpiresAt,
    };
  } catch {
    return null;
  }
}

async function ensureSessionValid(session: HandoverSession | null): Promise<HandoverSession | null> {
  if (!session) return null;
  if (!session.expiresAt) return session;

  const tokens = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };

  if (!isTokenExpired(tokens)) return session;

  if (session.refreshToken) {
    if (isLocalSession(session)) {
      try {
        const refreshed = await AuthService.refresh(session.refreshToken);
        const nextSession: HandoverSession = {
          ...session,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? session.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
        await setSession(nextSession);
        return nextSession;
      } catch {
        await setSession(null);
        return null;
      }
    }

    const refreshed = await refreshSessionWithOidc(session);
    if (refreshed) {
      await setSession(refreshed);
      return refreshed;
    }
  }

  await setSession(null);
  return null;
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
    await secureDeleteItem(SESSION_KEY);
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
  await secureSetItem(SESSION_KEY, JSON.stringify(normalized));
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
        const persisted = (await secureGetItem(SESSION_KEY)) ?? null;
        if (persisted) {
          currentSession = normalizeSession(parseSession(persisted));
          if (currentSession) {
            await persistTokens(currentSession);
            const refreshed = await ensureSessionValid(currentSession);
            currentSession = refreshed;
          }
          return currentSession;
        }
      } catch {
      }

      try {
        currentSession = await migrateFromAsyncStorage();
        if (currentSession) {
          await persistSession(currentSession);
          await persistTokens(currentSession);
          const refreshed = await ensureSessionValid(currentSession);
          currentSession = refreshed;
        }
      } catch {
        currentSession = null;
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
            const refreshedTokens = await AuthService.refresh(storedTokens.refreshToken);
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
  const rawRoles = (
    profile["roles"] ??
    profile["role"] ??
    profile["app_metadata"] ??
    // ✅ TU namespace real (con y sin slash)
    profile["https://api.luis-soto.info/roles"] ??
    profile["https://api.luis-soto.info//roles"] ??
    // ✅ por si algún día cambias a "/roles" explícito
    profile["https://api.luis-soto.info/roles".replace(/\/+roles$/, "/roles")] ??
    // ✅ tus antiguos (si los quieres mantener)
    profile["https://handover/roles"] ??
    profile["https://handoverpro/roles"]
  ) as unknown;

  const roles: string[] = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === "string")
    : typeof rawRoles === "string"
      ? rawRoles.split(/[,\s]+/).filter(Boolean)
      : [];

  const allowed: UserRole[] = [];
for (const role of roles) {
  const normalized = role.trim().toLowerCase();

  if (
    normalized === "nurse" ||
    normalized === "supervisor" ||
    normalized === "admin" ||
    normalized === "viewer"
  ) {
    allowed.push(normalized as UserRole);
  }
}

return allowed.length ? allowed : [NO_ROLE];
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
  const audience =
    config?.audience?.trim() ||
    (DEFAULT_AUTH_CONFIG as { audience?: string }).audience;
  return {
    issuer: config?.issuer ?? DEFAULT_AUTH_CONFIG.issuer,
    clientId: config?.clientId ?? DEFAULT_AUTH_CONFIG.clientId,
    redirectUri: config?.redirectUri ?? DEFAULT_AUTH_CONFIG.redirectUri,
    logoutUri: config?.logoutUri ?? DEFAULT_AUTH_CONFIG.logoutUri,
    scopes: config?.scopes ?? DEFAULT_AUTH_CONFIG.scopes,
    ...(audience ? { audience } : {}),
  };
}

function buildExtraParams(audience?: string) {
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

  if (__DEV__) {
    console.log('[AUTH] profile keys:', Object.keys(profile));
    console.log('[AUTH] roles claim:', (profile as any)['https://api.luis-soto.info/roles']);
  }

  const ROLE_CLAIMS = [
  "https://handover.luis-soto.info/roles",
  "https://api.luis-soto.info/roles",
  "https://handover/roles",
] as const;

function extractRoles(profile: Record<string, unknown>, decodedIdToken?: Record<string, unknown>): string[] {
  for (const claim of ROLE_CLAIMS) {
    const fromProfile = profile?.[claim] as unknown;
    if (Array.isArray(fromProfile)) return fromProfile.filter((x): x is string => typeof x === "string");

    const fromId = decodedIdToken?.[claim] as unknown;
    if (Array.isArray(fromId)) return fromId.filter((x): x is string => typeof x === "string");
  }
  return [];
}

const roles = extractRoles(profile, decodedIdToken ?? undefined);

if (__DEV__) {
  console.log("[AUTH] profile keys:", Object.keys(profile));
  console.log("[AUTH] extracted roles:", roles);
}

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
  const type = (error as { type?: string }).type;
  return message.includes('OAUTH_CANCELLED') || type === 'dismiss' || type === 'cancel';
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
        id: "nurse001",
        name: "Luis Enfermero",
        roles: ["admin"],
        units: ["UCI"],
      },
      accessToken: "local-dev-token",
    });
  }

  const config = buildAuthConfig(options.config);
  let discovery = options.discovery;

  if (!discovery) {
    try {
      discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);
    } catch (error) {
      console.warn("[AUTH][ERROR][LOGIN_FAILED]", { error: "discovery_failed" });
      throw error;
    }
  }

  const authResult = await options.promptAsync();

  if (authResult.type === "dismiss") {
    console.warn("[AUTH][WARN][LOGIN_CANCELLED]", {
      reason: (authResult as { error?: string }).error ?? "user_cancelled",
    });
    const cancelledError = new Error("OAUTH_CANCELLED");
    (cancelledError as Error & { type?: string }).type = "dismiss";
    throw cancelledError;
  }

  if (authResult.type === "error") {
    const errorCode =
      (authResult as { errorCode?: string; error?: string }).errorCode ??
      (authResult as { error?: string }).error ??
      "unknown_error";
    console.warn("[AUTH][ERROR][LOGIN_FAILED]", { error: errorCode });
    const authError = new Error("OAUTH_FAILED");
    (authError as Error & { type?: string }).type = "error";
    throw authError;
  }

  if (authResult.type !== "success") {
    console.warn("[AUTH][WARN][LOGIN_CANCELLED]", { reason: "user_cancelled" });
    const cancelledError = new Error("OAUTH_CANCELLED");
    (cancelledError as Error & { type?: string }).type = authResult.type;
    throw cancelledError;
  }

  // OJO: en PKCE, aquí muchas veces NO hay accessToken aún
  if (__DEV__) {
    console.log("[AUTH][DEV] full auth result:", authResult);
  }

  const tokens = await resolveTokensFromResult({
    request: options.request,
    result: authResult,
    discovery,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
  });

  if (__DEV__) {
  console.log("[AUTH][DEV] tokens keys:", Object.keys(tokens ?? {}));
  console.log("[AUTH][DEV] has access_token:", !!tokens?.accessToken);

  // Segments (lo que necesitamos ahora)
  console.log("[AUTH][DEV] idToken segments:", tokens?.idToken?.split(".").length);
  console.log("[AUTH][DEV] accessToken segments:", tokens?.accessToken?.split(".").length);

  // FULL (solo 1 vez para copiar en jwt.io; luego bórralo)
  console.log("[AUTH][DEV] idToken FULL:", tokens?.idToken);
  console.log("[AUTH][DEV] accessToken FULL:", tokens?.accessToken);
}


  const session = await buildSessionFromTokens(tokens, discovery);

  // ✅ ESTE es el lugar correcto
  if (__DEV__) {
  console.log("[AUTH] accessToken present:", !!session.accessToken);
  console.log("[AUTH] accessToken preview:", session.accessToken?.slice(0, 12));
}

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
    extraParams: buildExtraParams(merged.audience),
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
      roles: ["admin"],
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
        return `https://${AUTH0_DOMAIN}`;
      }
    })();

    try {
      const authUrl = `${issuerOrigin}/v2/logout?client_id=${config.clientId}&returnTo=${encodeURIComponent(
        config.logoutUri,
      )}`;
      await WebBrowser.openAuthSessionAsync(authUrl, config.logoutUri);
    } catch {
    }

    await setSession(null);
    if (message) {
      Alert.alert(t('auth.sessionExpiredTitle'), message);
    }
    resetTo("Login");
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
      if (options.message) Alert.alert(t('auth.sessionExpiredTitle'), options.message);
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

  const expiresAtMs = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  const isExpiring = !Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() <= skewMs;

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

      const config = buildAuthConfig();
      const discovery = await AuthSession.fetchDiscoveryAsync(config.issuer);

      const tokenEndpoint = discovery?.tokenEndpoint;
      if (!tokenEndpoint) {
        warnAuth('AUTH_REFRESH_NO_TOKEN_ENDPOINT');
        return session;
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
        return session;
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

      return nextSession;
    } catch {
      return session;
    } finally {
      refreshInFlight = null;
    }
  })();

  const refreshedSession = await refreshInFlight;
  return refreshedSession?.accessToken ?? accessToken;
}

// Alias usado por algunos tests / consumers
export const ensureFreshAccessToken = ensureFreshToken;


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

interface AuthContextValue {
  session: SessionModel | null;
  capabilities: Capabilities | null;
  loading: boolean;
  loginWithOAuth: (config?: Partial<typeof DEFAULT_AUTH_CONFIG>) => Promise<SessionModel>;
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
    const result = await AuthService.login(params.username, params.password);
    const session: HandoverSession = {
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
    await setSession(session);
    return session;
  }, []);

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

  useEffect(() => {
    let alive = true;

    if (!session) {
      setCapabilitiesState(null);
      void clearCapabilitiesCache();
      return () => {
        alive = false;
      };
    }

    if (session?.mode === 'demo') {
      setCapabilitiesState(getDemoCapabilities(session.userId));
      return () => {
        alive = false;
      };
    }

    (async () => {
      const caps = await fetchCapabilities();
      if (alive) setCapabilitiesState(caps);
    })();

    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    configureFHIRClient({
        ensureFreshToken: () => ensureFreshToken('fhir'),
      logout: async () =>
        logoutAndClear({
          skipRemote: true,
          message: t('auth.sessionExpiredMessage'),
        }),
    });
  }, []);

  const loginWithAuth0 = useCallback(async () => {
    if (!authRequest) {
      throw new Error('AUTH_REQUEST_NOT_READY');
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
        Alert.alert(t('auth.invalidCredentialsTitle'), t('auth.invalidCredentialsMessage'));
      }
      throw error;
    }
  }, [authConfig, authRequest, discovery, promptAsync]);

  const refreshCapabilities = useCallback(async () => {
    if (!session) {
      setCapabilitiesState(null);
      return null;
    }
    if (session.mode === 'demo') {
      const demoCaps = getDemoCapabilities(session.userId);
      setCapabilitiesState(demoCaps);
      return demoCaps;
    }
    const caps = await fetchCapabilities({ forceRefresh: true });
    setCapabilitiesState(caps);
    return caps;
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    capabilities,
    loading,
    loginWithOAuth: loginWithAuth0,
    loginWithCredentials,
    loginDemo,
    logout,
    refreshCapabilities,
  }), [session, capabilities, loading, loginWithAuth0, loginWithCredentials, refreshCapabilities]);

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
