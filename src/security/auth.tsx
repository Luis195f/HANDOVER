// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { Buffer } from 'buffer';

import { ensureDemoSessionTemplate } from '@/src/demo/fixtures';
import type { AuthSession as StoredAuthSession, HandoverSession, HandoverUser, UserRole } from './auth-types';
import { secureDeleteItem, secureGetItem, secureSetItem } from './secure-storage';
import navigation from '@/src/navigation/navigation';
import { configureFHIRClient } from '@/src/lib/fhir-client';

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
  | 'AUTH_REFRESH_FAILED'
  | 'AUTH_REFRESH_START'
  | 'AUTH_REFRESH_SUCCESS'
  | 'AUTH_REFRESH_SKIPPED';

function warnAuth(code: AuthWarnCode, meta: Record<string, unknown> = {}) {
  // PHI-SAFE: NO tokens, NO OAuth params (code), NO emails/nombres, NO claims completos.
  console.warn(`[AUTH][${code}]`, { ts: new Date().toISOString(), ...meta });
}

function safeIssuerHost(issuer?: string): string | null {
  if (!issuer) return null;
  try { return new URL(issuer).host; } catch { return null; }
}

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  const parts = raw
    .split(/[\s,]+/g)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function lastChars(value: string | undefined, n = 6): string | null {
  if (!value) return null;
  return value.length <= n ? value : value.slice(-n);
}

try {
  WebBrowser.maybeCompleteAuthSession();
} catch (error) {
  if (isDev) console.warn('[auth] Failed to complete auth session', error);
}

/* BEGIN HANDOVER: AUTH_CONFIG */
const PLACEHOLDER_AUTH0_DOMAIN = 'dev-6jmxxysflz2kx61w.us.auth0.com';
const PLACEHOLDER_AUTH0_CLIENT_ID = 'zJxhI0SK1J4hmzr1KNzEbWddgZWJDUlL';

// Auth0 legacy (compat)
const AUTH0_DOMAIN =
  process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? PLACEHOLDER_AUTH0_DOMAIN;

const AUTH0_CLIENT_ID =
  process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? PLACEHOLDER_AUTH0_CLIENT_ID;

// OIDC genérico preferente (prod)
const OIDC_ISSUER =
  process.env.EXPO_PUBLIC_OIDC_ISSUER ??
  // fallback a Auth0 issuer si no se setea OIDC_ISSUER
  (AUTH0_DOMAIN ? `https://${AUTH0_DOMAIN}` : undefined);

const OIDC_CLIENT_ID =
  process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ??
  AUTH0_CLIENT_ID;

const OIDC_AUDIENCE =
  process.env.EXPO_PUBLIC_OIDC_AUDIENCE ??
  process.env.EXPO_PUBLIC_AUTH0_AUDIENCE;

// scopes preferentes (permitir offline_access si el IdP lo soporta)
const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const OIDC_SCOPES = parseScopes(
  process.env.EXPO_PUBLIC_OIDC_SCOPES ?? process.env.EXPO_PUBLIC_AUTH0_SCOPES,
  DEFAULT_SCOPES,
);

const REDIRECT_URI =
  process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI ??
  process.env.EXPO_PUBLIC_AUTH0_REDIRECT_URI ??
  AuthSession.makeRedirectUri({
    native: 'handover-pro://callback',
    scheme: 'handover-pro',
    path: 'callback',
  });

// EXPO_PUBLIC_AUTH0_LOGOUT_URI debe ser un deep link válido (ej: handover-pro://auth/logout) cuando se defina.
const LOGOUT_REDIRECT_URI =
  process.env.EXPO_PUBLIC_OIDC_LOGOUT_URI ??
  process.env.EXPO_PUBLIC_AUTH0_LOGOUT_URI ??
  AuthSession.makeRedirectUri({ path: 'auth/logout' });

const DEFAULT_AUTH_CONFIG = {
  issuer: OIDC_ISSUER ?? `https://${AUTH0_DOMAIN}`,
  clientId: OIDC_CLIENT_ID,
  audience: OIDC_AUDIENCE,
  redirectUri: REDIRECT_URI,
  logoutUri: LOGOUT_REDIRECT_URI,
  scopes: OIDC_SCOPES,
};
/* END HANDOVER: AUTH_CONFIG */

let cachedDiscovery: AuthSession.DiscoveryDocument | null = null;
let cachedDiscoveryIssuer: string | null = null;

async function getDiscovery(issuer: string): Promise<AuthSession.DiscoveryDocument> {
  if (cachedDiscovery && cachedDiscoveryIssuer === issuer) return cachedDiscovery;
  const discovery = await AuthSession.fetchDiscoveryAsync(issuer);
  cachedDiscovery = discovery;
  cachedDiscoveryIssuer = issuer;
  return discovery;
}

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
const listeners: Array<(session: HandoverSession | null) => void> = [];
let logoutInFlight: Promise<void> | null = null;
let pendingLogoutMessage: string | undefined;
let refreshPromise: Promise<boolean> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function isoToMs(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function isExpiringSoon(expiresAtIso?: string, skewMs = 90_000): boolean {
  const ms = isoToMs(expiresAtIso);
  if (!ms) return false;
  return Date.now() >= ms - skewMs;
}

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefreshForSession(session: SessionModel | null) {
  clearRefreshTimer();
  if (!session) return;
  if (session.mode === 'demo') return;
  if (!session.refreshToken) return;

  const expiresMs = isoToMs(session.expiresAt);
  if (!expiresMs) return;

  const skewMs = 90_000;
  const delay = Math.max(5_000, expiresMs - Date.now() - skewMs);

  refreshTimer = setTimeout(() => {
    void refreshAccessToken('timer');
  }, delay);
}

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
      scheduleRefreshForSession(currentSession);
      return currentSession;
    }
  } catch (error) {
    if (isDev) console.warn('[auth] Failed to read persisted session', error);
  }

  try {
    currentSession = await migrateFromAsyncStorage();
    if (currentSession) {
      await persistSession(currentSession);
      scheduleRefreshForSession(currentSession);
    }
  } catch (error) {
    if (isDev) console.warn('[auth] Failed to migrate session', error);
    currentSession = null;
  }

  scheduleRefreshForSession(currentSession);
  return currentSession;
}

async function setSession(session: HandoverSession | null): Promise<void> {
  currentSession = session ? normalizeSession({ ...session }) : null;
  await persistSession(currentSession);
  notify(currentSession);
  scheduleRefreshForSession(currentSession);
}

async function refreshAccessToken(reason: 'startup' | 'timer' | 'fhir' | '401'): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const cfg = buildAuthConfig();
    // en prod, si misconfig, aquí debe fallar temprano
    assertOidcConfigOrThrow(cfg as any);

    // Asegura que hay sesión cargada
    await getCurrentSession();
    const session = currentSession;

    if (!session) {
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'no_session' });
      return false;
    }
    if (session.mode === 'demo') {
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'demo_mode' });
      return false;
    }
    if (!session.refreshToken) {
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'missing_refresh_token' });
      return false;
    }

    // Si no está por expirar y no es 401, no refrescar
    if (reason !== '401' && !isExpiringSoon(session.expiresAt)) {
      warnAuth('AUTH_REFRESH_SKIPPED', { reason, issuerHost: safeIssuerHost(cfg.issuer) });
      return true;
    }

    warnAuth('AUTH_REFRESH_START', { op: 'refresh', reason, issuerHost: safeIssuerHost(cfg.issuer) });

    let discovery: AuthSession.DiscoveryDocument;
    try {
      discovery = await getDiscovery(cfg.issuer);
    } catch {
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'discovery_failed' });
      return false;
    }

    if (!discovery.tokenEndpoint) {
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'missing_token_endpoint' });
      return false;
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        refresh_token: session.refreshToken,
      });

      const resp = await fetch(discovery.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const payload = (await resp.json().catch(() => ({}))) as any;

      if (!resp.ok) {
        const status = resp.status;
        const err = String(payload?.error ?? '');
        warnAuth('AUTH_REFRESH_FAILED', { reason, status, why: err || 'http_error' });

        // Fatal → logout local (sin remote) SOLO si invalid_grant / 400/401
        if (status === 400 || status === 401 || err === 'invalid_grant') {
          await logoutAndClear({
            skipRemote: true,
            message: 'Sesión expirada, inicia sesión de nuevo',
          });
        }
        return false;
      }

      const nextAccess = payload?.access_token as string | undefined;
      const nextRefresh = payload?.refresh_token as string | undefined;
      const expiresIn = payload?.expires_in as number | undefined;
      const nextId = payload?.id_token as string | undefined;

      if (!nextAccess) {
        warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'missing_access_token' });
        return false;
      }

      const nextExpiresAt = expiresIn
        ? normalizeExpiresAt(Math.floor(Date.now() / 1000) + expiresIn)
        : session.expiresAt;

      await setSession({
        ...session,
        accessToken: nextAccess,
        refreshToken: nextRefresh ?? session.refreshToken,
        idToken: nextId ?? session.idToken,
        expiresAt: nextExpiresAt,
      });

      warnAuth('AUTH_REFRESH_SUCCESS', { op: 'refresh', reason, hasRefreshToken: true });
      return true;
    } catch {
      // Red/timeout → NO logout automático
      warnAuth('AUTH_REFRESH_FAILED', { reason, why: 'network_or_exception' });
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
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
    audience: config?.audience ?? DEFAULT_AUTH_CONFIG.audience,
    redirectUri: config?.redirectUri ?? DEFAULT_AUTH_CONFIG.redirectUri,
    logoutUri: config?.logoutUri ?? DEFAULT_AUTH_CONFIG.logoutUri,
    scopes: config?.scopes ?? DEFAULT_AUTH_CONFIG.scopes,
  };
}

function isPlaceholderConfig(cfg: ReturnType<typeof buildAuthConfig>): boolean {
  const issuerHost = safeIssuerHost(cfg.issuer) ?? '';
  const isAuth0Placeholder =
    issuerHost === PLACEHOLDER_AUTH0_DOMAIN &&
    cfg.clientId === PLACEHOLDER_AUTH0_CLIENT_ID;

  const hasExplicitOidc =
    !!process.env.EXPO_PUBLIC_OIDC_ISSUER || !!process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;

  // Placeholder si está usando defaults y no hay OIDC explícito
  return isAuth0Placeholder && !hasExplicitOidc;
}

function assertOidcConfigOrThrow(cfg: ReturnType<typeof buildAuthConfig>) {
  const issues: string[] = [];
  if (!cfg.issuer) issues.push('issuer');
  if (!cfg.clientId) issues.push('clientId');
  if (!cfg.redirectUri) issues.push('redirectUri');
  if (!cfg.logoutUri) issues.push('logoutUri');
  if (!cfg.scopes || !cfg.scopes.length) issues.push('scopes');

  const placeholder = isPlaceholderConfig(cfg);

  // En producción (no dev), NO aceptar placeholders o faltantes
  if (!isDev && (issues.length > 0 || placeholder)) {
    warnAuth('AUTH_OIDC_MISCONFIG', {
      issues,
      placeholder,
      issuerHost: safeIssuerHost(cfg.issuer),
      clientIdSuffix: lastChars(cfg.clientId),
      scopesCount: cfg.scopes?.length ?? 0,
      hasAudience: !!cfg.audience,
    });
    throw new Error('AUTH_OIDC_MISCONFIG');
  }

  // En dev, solo log informativo (PHI-safe)
  warnAuth('AUTH_RUNTIME_CONFIG', {
    issuerHost: safeIssuerHost(cfg.issuer),
    clientIdSuffix: lastChars(cfg.clientId),
    scopesCount: cfg.scopes?.length ?? 0,
    hasAudience: !!cfg.audience,
  });
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
  if (process.env.EXPO_PUBLIC_AUTH_DISABLED === 'true') {
    // Creamos una sesión real local, sin modo demo
    return login({
      user: {
        id: 'nurse001',
        name: 'Local Dev User',
        roles: ['nurse'],
        units: ['UCI'],
      },
      accessToken: 'local-dev-token',
    });
  }
  const config = buildAuthConfig(options.config);
  const discovery = options.discovery ?? (await getDiscovery(config.issuer));

  const authResult = await options.promptAsync();

  warnAuth('AUTH_LOGIN_RESULT', { type: authResult.type });
  warnAuth('AUTH_RUNTIME_CONFIG', {
    issuerHost: safeIssuerHost(config.issuer),
    clientIdSuffix: lastChars(config.clientId),
    scopesCount: config.scopes?.length ?? 0,
    hasAudience: !!(config as any).audience,
  });

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
  assertOidcConfigOrThrow(merged);
  const discovery = await getDiscovery(merged.issuer);
  const request = new AuthSession.AuthRequest({
    clientId: merged.clientId,
    redirectUri: merged.redirectUri,
    scopes: merged.scopes,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
    extraParams: merged.audience ? { audience: String(merged.audience) } : undefined,
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
    const issuerHost = safeIssuerHost(config.issuer);
    const isAuth0 = !!issuerHost && issuerHost.endsWith('.auth0.com');

    if (isAuth0) {
      const authUrl = `https://${issuerHost}/v2/logout?client_id=${config.clientId}&returnTo=${encodeURIComponent(
        config.logoutUri,
      )}`;
      try {
        await WebBrowser.openAuthSessionAsync(authUrl, config.logoutUri);
      } catch (error) {
        if (isDev) console.warn('[auth] logout failed', error);
      }
    } else {
      warnAuth('AUTH_LOGOUT', { reason: 'local_only', issuerHost });
    }

    await setSession(null);
    if (message) {
      Alert.alert('Sesión expirada', message);
    }
    warnAuth('AUTH_LOGOUT', { reason: message ? 'expired' : 'manual', issuerHost });
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

export async function setCurrentSession(session: SessionModel | null): Promise<void> {
  await setSession(session);
}

export async function ensureFreshAccessToken(reason: 'startup' | 'fhir' | 'manual' = 'fhir'): Promise<string | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  if (session.mode === 'demo') return session.accessToken ?? null;

  // Si está por expirar, intenta refresh
  if (session.refreshToken && isExpiringSoon(session.expiresAt)) {
    await refreshAccessToken(reason === 'startup' ? 'startup' : 'fhir');
  }

  return currentSession?.accessToken ?? null;
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
      extraParams: authConfig.audience ? { audience: String((authConfig as any).audience) } : undefined,
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
        scheduleRefreshForSession(hydratedSession);
        if (hydratedSession?.refreshToken && isExpiringSoon(hydratedSession.expiresAt)) {
          await refreshAccessToken('startup');
          if (!mounted) return;
          setSessionState(currentSession);
        }
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
      ensureFreshToken: async () => await ensureFreshAccessToken('fhir'),
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
      assertOidcConfigOrThrow(authConfig as any);
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
