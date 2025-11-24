// BEGIN HANDOVER_AUTH
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { AuthSession as StoredSession, HandoverSession, UserRole } from './auth-types';
import { secureDeleteItem, secureGetItem, secureSetItem } from './secure-storage';

WebBrowser.maybeCompleteAuthSession();

const STORAGE_NAMESPACE = resolveNamespace();
const SESSION_KEY = `${STORAGE_NAMESPACE}:auth-session`;
const TOKENS_KEY = `${STORAGE_NAMESPACE}:auth-tokens`;
const CLAIMS_KEY = `${STORAGE_NAMESPACE}:auth-claims`;

const TOKEN_REFRESH_THRESHOLD_SECONDS = 120;

const ALLOWED_ROLES: ReadonlySet<UserRole> = new Set(['nurse', 'supervisor', 'admin']);
const MOCK_AUTH_ENABLED =
  (process.env.EXPO_PUBLIC_USE_MOCK_AUTH ?? process.env.USE_MOCK_AUTH ?? '').toLowerCase() === 'true';

export type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch seconds
  idToken?: string;
  scope?: string;
};

export type Session = HandoverSession;

export type AuthState = {
  session: HandoverSession | null;
  tokens: TokenBundle | null;
  claims?: Record<string, unknown> | null;
};

let hydrated = false;
let currentSession: HandoverSession | null = null;
let currentTokens: TokenBundle | null = null;
let currentClaims: Record<string, unknown> | null = null;

const listeners = new Set<(state: AuthState) => void>();

function resolveNamespace(): string {
  const explicit =
    process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ??
    process.env.STORAGE_NAMESPACE ??
    (Constants.expoConfig?.extra?.STORAGE_NAMESPACE as string | undefined);
  return explicit ?? 'handover';
}

function readEnv(name: string): string | undefined {
  const value = Constants.expoConfig?.extra?.[name];
  if (typeof value === 'string') return value;
  return process.env[`EXPO_PUBLIC_${name}`] ?? process.env[name];
}

export type OIDCConfig = {
  issuer: string;
  clientId: string;
  audience?: string;
  scopes: string[];
  redirectUri: string;
};

function getOidcConfig(): OIDCConfig {
  const issuer = readEnv('OIDC_ISSUER') ?? 'https://example.dev/issuer';
  const clientId = readEnv('OIDC_CLIENT_ID') ?? 'handover-mobile';
  const scopes = (readEnv('OIDC_SCOPES') ?? 'openid profile email offline_access').split(/\s+/).filter(Boolean);
  const redirectUri =
    readEnv('OIDC_REDIRECT_URI') ??
    AuthSession.makeRedirectUri({ useProxy: false, scheme: readEnv('OIDC_REDIRECT_SCHEME') ?? 'handoverpro' });
  const audience = readEnv('OIDC_AUDIENCE');
  return { issuer: issuer.replace(/\/$/, ''), clientId, audience, scopes, redirectUri };
}

function notify(): void {
  const snapshot: AuthState = {
    session: currentSession ? { ...currentSession, roles: [...currentSession.roles], units: [...currentSession.units] } : null,
    tokens: currentTokens ? { ...currentTokens } : null,
    claims: currentClaims ? { ...currentClaims } : null,
  };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('auth listener error', error);
    }
  });
}

async function persistAuth(tokens: TokenBundle, session: HandoverSession, claims: Record<string, unknown> | null) {
  currentSession = { ...session, roles: [...session.roles], units: [...session.units] };
  currentTokens = { ...tokens };
  currentClaims = claims ? { ...claims } : null;
  await Promise.all([
    secureSetItem(SESSION_KEY, JSON.stringify(currentSession)),
    secureSetItem(TOKENS_KEY, JSON.stringify(currentTokens)),
    claims ? secureSetItem(CLAIMS_KEY, JSON.stringify(claims)) : secureDeleteItem(CLAIMS_KEY),
  ]);
  notify();
}

async function hydrateSession(): Promise<AuthState> {
  if (hydrated) return { session: currentSession, tokens: currentTokens, claims: currentClaims };
  hydrated = true;

  const [rawSession, rawTokens, rawClaims] = await Promise.all([
    secureGetItem(SESSION_KEY),
    secureGetItem(TOKENS_KEY),
    secureGetItem(CLAIMS_KEY),
  ]);

  if (rawSession && rawTokens) {
    try {
      currentSession = normalizeSession(JSON.parse(rawSession) as StoredSession);
    } catch (error) {
      console.warn('Failed to parse stored session', error);
      currentSession = null;
    }

    try {
      currentTokens = JSON.parse(rawTokens) as TokenBundle;
    } catch (error) {
      console.warn('Failed to parse stored tokens', error);
      currentTokens = null;
    }

    if (rawClaims) {
      try {
        currentClaims = JSON.parse(rawClaims) as Record<string, unknown>;
      } catch (error) {
        console.warn('Failed to parse stored claims', error);
        currentClaims = null;
      }
    }
  }

  if (!currentSession || !currentTokens) {
    await clearPersistedAuth();
  }

  return { session: currentSession, tokens: currentTokens, claims: currentClaims };
}

function normalizeSession(session: StoredSession | null): HandoverSession | null {
  if (!session) return null;
  const roles = Array.isArray(session.roles)
    ? session.roles.filter((role): role is UserRole => ALLOWED_ROLES.has(role as UserRole))
    : [];
  const units = Array.isArray(session.units)
    ? session.units.filter((unit): unit is string => typeof unit === 'string')
    : [];
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    userId: session.userId,
    displayName: session.displayName ?? session.userId,
    roles: roles.length ? roles : ['nurse'],
    units,
  };
}

async function clearPersistedAuth(): Promise<void> {
  currentSession = null;
  currentTokens = null;
  currentClaims = null;
  await Promise.all([secureDeleteItem(SESSION_KEY), secureDeleteItem(TOKENS_KEY), secureDeleteItem(CLAIMS_KEY)]);
  notify();
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    if (typeof globalThis.atob === 'function') return globalThis.atob(padded);
    const buf = (globalThis as { Buffer?: { from: (input: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
    if (buf) return buf.from(padded, 'base64').toString('utf-8');
  } catch (error) {
    console.warn('Failed to decode base64 payload', error);
  }
  return null;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const decoded = decodeBase64Url(payload);
    if (!decoded) return null;
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch (error) {
    console.warn('Failed to parse JWT', error);
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => `${v}`).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  return [];
}

function extractRoles(profile: Record<string, unknown> | null): UserRole[] {
  if (!profile) return ['nurse'];
  const candidates = [
    profile['roles'],
    profile['app_metadata'],
    profile['realm_access'] && (profile['realm_access'] as Record<string, unknown>)['roles'],
    profile['https://roles'],
  ];
  const roles = new Set<UserRole>();
  candidates.forEach((candidate) => {
    toStringArray(candidate).forEach((role) => {
      if (ALLOWED_ROLES.has(role as UserRole)) {
        roles.add(role as UserRole);
      }
    });
  });
  return roles.size ? Array.from(roles) : ['nurse'];
}

function extractUnits(profile: Record<string, unknown> | null): string[] {
  if (!profile) return [];
  const candidates = [profile['units'], profile['allowedUnits'], profile['https://units']];
  const units = new Set<string>();
  candidates.forEach((candidate) => {
    toStringArray(candidate).forEach((unit) => units.add(unit));
  });
  return Array.from(units);
}

function buildSession(tokens: TokenBundle, claims: Record<string, unknown> | null): HandoverSession {
  const userId = (claims?.sub as string | undefined) ?? (claims?.['preferred_username'] as string | undefined) ?? 'unknown-user';
  const displayName =
    (claims?.['name'] as string | undefined) ?? (claims?.['preferred_username'] as string | undefined) ?? userId;
  const roles = extractRoles(claims);
  const units = extractUnits(claims);
  const expiresAt = new Date(tokens.expiresAt * 1000).toISOString();
  return {
    userId,
    displayName,
    roles,
    units,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt,
  };
}

async function fetchUserInfo(userInfoEndpoint: string | undefined, accessToken: string) {
  if (!userInfoEndpoint) return null;
  try {
    const response = await fetch(userInfoEndpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn('Failed to load userinfo', error);
    return null;
  }
}

function buildTokensFromResponse(response: AuthSession.TokenResponse | AuthSession.TokenResponseConfig): TokenBundle {
  const issuedAt = (response as AuthSession.TokenResponse).issuedAt ?? Math.floor(Date.now() / 1000);
  const expiresIn = Math.max((response as AuthSession.TokenResponse).expiresIn ?? 3600, 0);
  return {
    accessToken: (response as AuthSession.TokenResponse).accessToken ?? (response as any).access_token ?? '',
    refreshToken:
      (response as AuthSession.TokenResponse).refreshToken ?? (response as any).refresh_token ?? undefined,
    expiresAt: issuedAt + expiresIn,
    idToken: (response as AuthSession.TokenResponse).idToken ?? (response as any).id_token ?? undefined,
    scope: (response as AuthSession.TokenResponse).scope,
  };
}

async function applyTokenResponse(
  response: AuthSession.TokenResponse,
  discovery: AuthSession.DiscoveryDocument | null,
): Promise<HandoverSession> {
  const tokens = buildTokensFromResponse(response);
  if (!tokens.accessToken) {
    throw new Error('OIDC exchange did not return an access token');
  }
  const claims = tokens.idToken ? decodeJwtClaims(tokens.idToken) : null;
  const enrichedClaims = claims ?? (await fetchUserInfo(discovery?.userInfoEndpoint, tokens.accessToken));
  if (!enrichedClaims) {
    throw new Error('Unable to resolve user profile from tokens');
  }
  const session = buildSession(tokens, enrichedClaims);
  await persistAuth(tokens, session, enrichedClaims);
  return session;
}

export async function logout(): Promise<void> {
  await hydrateSession();
  await clearPersistedAuth();
}

export async function loginWithMockUser(): Promise<HandoverSession> {
  if (!MOCK_AUTH_ENABLED) {
    throw new Error('Mock auth disabled. Set USE_MOCK_AUTH=true to enable.');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokens: TokenBundle = {
    accessToken: 'mock-token',
    refreshToken: undefined,
    expiresAt: issuedAt + 3600,
  };
  const session: HandoverSession = {
    userId: 'mock-user',
    displayName: 'Demo User',
    roles: ['nurse'],
    units: ['demo-unit'],
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(tokens.expiresAt * 1000).toISOString(),
  };
  await persistAuth(tokens, session, { sub: session.userId, roles: session.roles, units: session.units });
  return session;
}

export const loginWithOAuth = loginWithOIDC;

export async function refreshTokenIfNeeded(
  config?: OIDCConfig,
  discovery?: AuthSession.DiscoveryDocument | null,
): Promise<HandoverSession | null> {
  await hydrateSession();
  if (!currentTokens) return null;
  const now = Math.floor(Date.now() / 1000);
  if (currentTokens.expiresAt - now > TOKEN_REFRESH_THRESHOLD_SECONDS) {
    return currentSession;
  }
  if (!currentTokens.refreshToken) {
    throw new Error('Refresh token missing');
  }

  const oidcConfig = config ?? getOidcConfig();
  const doc = discovery ?? (await AuthSession.fetchDiscoveryAsync(oidcConfig.issuer));
  const refreshed = (await AuthSession.refreshAsync(
    {
      clientId: oidcConfig.clientId,
      refreshToken: currentTokens.refreshToken,
      scopes: oidcConfig.scopes,
      extraParams: oidcConfig.audience ? { audience: oidcConfig.audience } : undefined,
    },
    doc,
  )) as AuthSession.TokenResponse;

  return applyTokenResponse(refreshed, doc);
}

async function handleAuthorizationCode(
  code: string,
  request: AuthSession.AuthRequest,
  config: OIDCConfig,
  discovery: AuthSession.DiscoveryDocument | null,
): Promise<HandoverSession> {
  const doc = discovery ?? (await AuthSession.fetchDiscoveryAsync(config.issuer));
  const redirectUri = request.redirectUri ?? config.redirectUri;
  const extraParams = {
    ...(config.audience ? { audience: config.audience } : undefined),
    ...(request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined),
  } as Record<string, string>;

  const tokenResponse = (await AuthSession.exchangeCodeAsync(
    {
      clientId: config.clientId,
      code,
      redirectUri,
      extraParams: Object.keys(extraParams).length ? extraParams : undefined,
    },
    doc,
  )) as AuthSession.TokenResponse;

  return applyTokenResponse(tokenResponse, doc);
}

export async function loginWithOIDC(
  providedConfig?: OIDCConfig,
  existingRequest?: AuthSession.AuthRequest | null,
  discoveryDoc?: AuthSession.DiscoveryDocument | null,
): Promise<HandoverSession> {
  const config = providedConfig ?? getOidcConfig();
  const discovery = discoveryDoc ?? (await AuthSession.fetchDiscoveryAsync(config.issuer));
  const authRequest =
    existingRequest ??
    (new AuthSession.AuthRequest({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
      codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
      extraParams: config.audience ? { audience: config.audience } : undefined,
    }) as AuthSession.AuthRequest);

  const result = await authRequest.promptAsync(discovery, { useProxy: false });
  if (result.type !== 'success' || !result.params?.code) {
    throw new Error(result.params?.error_description ?? 'OIDC login cancelled');
  }

  return handleAuthorizationCode(result.params.code, authRequest, config, discovery);
}

export async function getSession(): Promise<HandoverSession | null> {
  await hydrateSession();
  return currentSession;
}

export const getCurrentSession = getSession;

export async function setCurrentSession(session: HandoverSession | null): Promise<void> {
  if (!session || !currentTokens) {
    await clearPersistedAuth();
    return;
  }
  await persistAuth(currentTokens, session, currentClaims ?? {});
}

export function onAuthChange(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface AuthContextValue {
  session: HandoverSession | null;
  loading: boolean;
  loginWithOIDC: () => Promise<HandoverSession>;
  loginWithMockUser?: () => Promise<HandoverSession>;
  logout: () => Promise<void>;
  refresh: () => Promise<HandoverSession | null>;
  isMockAuthEnabled: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<HandoverSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [oidcConfig, setOidcConfig] = useState<OIDCConfig | null>(null);

  useEffect(() => {
    try {
      setOidcConfig(getOidcConfig());
    } catch (error) {
      console.error(error);
    }
  }, []);

  const discovery = AuthSession.useAutoDiscovery(oidcConfig?.issuer ?? '');

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    oidcConfig
      ? {
          clientId: oidcConfig.clientId,
          redirectUri: oidcConfig.redirectUri,
          scopes: oidcConfig.scopes,
          usePKCE: true,
          responseType: AuthSession.ResponseType.Code,
          codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
          extraParams: oidcConfig.audience ? { audience: oidcConfig.audience } : undefined,
        }
      : null,
    discovery,
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const state = await hydrateSession();
      if (!mounted) return;
      setSessionState(state.session);
      setLoading(false);
    })();
    const unsubscribe = onAuthChange((state) => setSessionState(state.session));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleAppStateChange = useCallback(
    (status: AppStateStatus) => {
      if (status === 'active' && oidcConfig) {
        void refreshTokenIfNeeded(oidcConfig, discovery ?? undefined);
      }
    },
    [discovery, oidcConfig],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [handleAppStateChange]);

  const loginWithOIDCInteractive = useCallback(async (): Promise<HandoverSession> => {
    const sessionResult = await loginWithOIDC(oidcConfig ?? undefined, request ?? undefined, discovery ?? null);
    setSessionState(sessionResult);
    return sessionResult;
  }, [discovery, oidcConfig, request]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      loginWithOIDC: loginWithOIDCInteractive,
      loginWithMockUser: MOCK_AUTH_ENABLED ? loginWithMockUser : undefined,
      logout: async () => {
        await logout();
        setSessionState(null);
      },
      refresh: async () => refreshTokenIfNeeded(oidcConfig ?? undefined, discovery ?? undefined),
      isMockAuthEnabled: MOCK_AUTH_ENABLED,
    }),
    [session, loading, loginWithOIDCInteractive, discovery, oidcConfig],
  );

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
