import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { clearAuthState, getAuthState, setAuthState, subscribe, type AuthTokens } from '@/src/state/auth-store';

// Ensure the auth session can be completed when the app is reopened via the redirect URI.
// Guarded to avoid test/runtime environments where WebBrowser may be unavailable.
try {
  if (!(process.env.VITEST || process.env.NODE_ENV === 'test')) {
    WebBrowser.maybeCompleteAuthSession();
  }
} catch {
  // no-op
}

export type { AuthTokens } from '@/src/state/auth-store';

export type Tokens = {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number;
  id_token?: string;
  scope?: string;
};

export type AuthErrorKind =
  | 'CONFIG'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'CANCELLED'
  | 'NETWORK'
  | 'UNAUTHENTICATED';

export class AuthError extends Error {
  kind: AuthErrorKind;

  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

type AuthSuccessResult = { status: 'success' };
type AuthCancelledResult = { status: 'cancelled' };
export type AuthFlowResult = AuthSuccessResult | AuthCancelledResult;

type DiscoveryDocument = {
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  revocationEndpoint?: string;
  userInfoEndpoint?: string;
};

type TokenResponse = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
  scope?: string;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
};

type AnyTokenResponse = TokenResponse & OAuthTokenResponse;

type AuthRequestLike = {
  codeVerifier?: string;
  redirectUri?: string;
  promptAsync: (
    discovery: DiscoveryDocument,
    options?: Record<string, unknown>
  ) => Promise<
    | ({ type: 'success'; params?: Record<string, string | undefined> } & AuthSession.AuthSessionResult)
    | { type: 'dismiss' | 'cancel'; params?: Record<string, string | undefined> }
  >;
};

export type User = {
  sub: string;
  name?: string;
  email?: string;
  role: 'nurse' | 'admin' | 'viewer' | 'supervisor';
  unitIds: string[];
};

type SecureStoreOptions = { keychainService?: string };

type SecureStoreModule = {
  getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
};

// Lazy-loaded to avoid Node/Vitest ESM/CJS interop issues with expo-secure-store.
// - In runtime (app), we expect expo-secure-store to be available.
// - In tests, we fall back to an in-memory implementation.
let secureStore: SecureStoreModule | null | undefined;
const memoryStore = new Map<string, string>();

export async function loadSecureStore(): Promise<SecureStoreModule | null> {
  if (secureStore !== undefined) return secureStore;

  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    secureStore = null;
    return null;
  }

  try {
    const mod: any = await import('expo-secure-store');
    const resolved: any = mod?.default ?? mod;

    if (resolved?.getItemAsync && resolved?.setItemAsync && resolved?.deleteItemAsync) {
      secureStore = resolved as SecureStoreModule;
      return secureStore;
    }

    secureStore = null;
    return null;
  } catch (err) {
    // En tests, NO reventar; fallback a memoria
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      console.warn('expo-secure-store unavailable, falling back to in-memory storage for tests');
      secureStore = null;
      return null;
    }
    throw err;
  }
}

const TOKEN_EXPIRY_SAFETY_WINDOW = 5;

const SECURE_STORE_OPTIONS: SecureStoreOptions = { keychainService: 'handoverpro' };

async function storeSet(key: string, value: string | null): Promise<void> {
  const ss = await loadSecureStore();

  if (!value) {
    if (ss) {
      await ss.deleteItemAsync(key, SECURE_STORE_OPTIONS);
    }
    memoryStore.delete(key);
    return;
  }

  if (ss) {
    await ss.setItemAsync(key, value, SECURE_STORE_OPTIONS);
  } else {
    memoryStore.set(key, value);
  }
}

async function storeGet(key: string): Promise<string | null> {
  const ss = await loadSecureStore();
  if (ss) {
    return ss.getItemAsync(key, SECURE_STORE_OPTIONS);
  }
  return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
}

const STORAGE_NAMESPACE = resolveNamespace();
const ACCESS_KEY = `${STORAGE_NAMESPACE}:auth:access`;
const REFRESH_KEY = `${STORAGE_NAMESPACE}:auth:refresh`;
const EXP_KEY = `${STORAGE_NAMESPACE}:auth:exp`;
const ID_TOKEN_KEY = `${STORAGE_NAMESPACE}:auth:id`;
const USER_KEY = `${STORAGE_NAMESPACE}:auth:user`;

function resolveNamespace(): string {
  const explicit =
    process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ??
    process.env.STORAGE_NAMESPACE ??
    (Constants.expoConfig?.extra?.STORAGE_NAMESPACE as string | undefined);
  return explicit && /^[\w.-]+$/.test(explicit) ? explicit : 'handover';
}

type OIDCConfig = {
  issuer: string;
  clientId: string;
  audience: string;
  scope: string;
  redirectScheme: string;
};

function readEnv(name: string): string | undefined {
  const expoExtra = Constants.expoConfig?.extra?.[name];
  if (expoExtra && typeof expoExtra === 'string') {
    return expoExtra;
  }
  return process.env[`EXPO_PUBLIC_${name}`] ?? process.env[name];
}

function requireEnv(name: string): string {
  const value = readEnv(name)?.trim();
  if (!value) {
    throw new AuthError('CONFIG', `Missing ${name}`);
  }
  return value;
}

function validateIssuer(issuer: string): void {
  try {
    // eslint-disable-next-line no-new
    new URL(issuer);
  } catch {
    throw new AuthError('CONFIG', 'OIDC_ISSUER must be a valid URL');
  }
}

function validateRedirectScheme(scheme: string): void {
  const schemePattern = /^[a-z][a-z0-9+.-]*$/i;
  if (!schemePattern.test(scheme)) {
    throw new AuthError('CONFIG', 'OIDC_REDIRECT_SCHEME must be a valid URI scheme');
  }
}

function loadOIDCConfig(): OIDCConfig {
  const issuer = requireEnv('OIDC_ISSUER');
  const clientId = requireEnv('OIDC_CLIENT_ID');
  const audience = requireEnv('OIDC_AUDIENCE');
  const scope = requireEnv('OIDC_SCOPE');
  const redirectScheme = requireEnv('OIDC_REDIRECT_SCHEME');
  validateIssuer(issuer);
  validateRedirectScheme(redirectScheme);
  return { issuer: issuer.replace(/\/$/, ''), clientId, audience, scope, redirectScheme };
}

const oidcConfig = loadOIDCConfig();

if (__DEV__) {
  console.info('[auth] OIDC runtime config', {
    issuer: oidcConfig.issuer,
    clientId: oidcConfig.clientId,
    redirectScheme: oidcConfig.redirectScheme,
    scope: oidcConfig.scope,
    hasAudience: true,
  });
}


let cachedDiscovery: DiscoveryDocument | null = null;
let discoveryPromise: Promise<DiscoveryDocument> | null = null;

async function getDiscovery(): Promise<DiscoveryDocument> {
  if (cachedDiscovery) {
    return cachedDiscovery;
  }
  if (!discoveryPromise) {
    discoveryPromise = AuthSession.fetchDiscoveryAsync(oidcConfig.issuer).then((doc) => {
      cachedDiscovery = doc;
      discoveryPromise = null;
      return doc;
    });
  }
  return discoveryPromise;
}

let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

async function hydrateFromStorage(): Promise<void> {
  if (hydrated) {
    return;
  }
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const [accessToken, refreshToken, expStr, idToken, userJson] = await Promise.all([
        storeGet(ACCESS_KEY),
        storeGet(REFRESH_KEY),
        storeGet(EXP_KEY),
        storeGet(ID_TOKEN_KEY),
        storeGet(USER_KEY),
      ]);
      hydrated = true;
      if (!accessToken || !expStr) {
        clearAuthState();
        return;
      }
      const expiresAt = Number.parseInt(expStr, 10);
      if (!Number.isFinite(expiresAt)) {
        clearAuthState();
        return;
      }
      if (expiresAt * 1000 <= Date.now()) {
        clearAuthState();
        return;
      }
      if (!idToken) {
        clearAuthState();
        return;
      }
      const tokens: AuthTokens = {
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresAt,
        idToken: idToken ?? undefined,
      };
      try {
        const { user } = validateIdToken(idToken);
        let persistedUser = user;
        if (userJson) {
          try {
            const parsed = JSON.parse(userJson) as User;
            persistedUser = {
              ...user,
              name: parsed.name ?? user.name,
              email: parsed.email ?? user.email,
              unitIds: parsed.unitIds?.length ? parsed.unitIds : user.unitIds,
            };
          } catch (error) {
            console.warn('Failed to parse stored user', error);
          }
        }
        setAuthState({ user: persistedUser, tokens });
      } catch (error) {
        if (error instanceof AuthError) {
          console.warn('Clearing stored auth due to token validation', error.message);
        }
        clearAuthState();
      }
    })().finally(() => {
      hydrationPromise = null;
    });
  }
  return hydrationPromise;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }
  const nodeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString(enc: string): string } } })
    .Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(padded, 'base64').toString('utf-8');
  }
  throw new AuthError('TOKEN_INVALID', 'No base64 decoder available');
}

function encodeBase64Url(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  throw new AuthError('TOKEN_INVALID', 'No base64 encoder available');
}

type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  sub?: unknown;
  name?: unknown;
  email?: unknown;
  [key: string]: unknown;
};

type ValidatedClaims = JwtClaims & { iss: string; aud: string | string[]; exp: number; sub: string };

function decodeJwtClaims(idToken: string): JwtClaims {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    throw new AuthError('TOKEN_INVALID', 'ID token is malformed');
  }
  try {
    const payload = decodeBase64Url(parts[1]);
    return JSON.parse(payload) as JwtClaims;
  } catch (error) {
    console.warn('Failed to decode id token', error);
    throw new AuthError('TOKEN_INVALID', 'Unable to decode id token');
  }
}

const roleValues = new Set<User['role']>(['nurse', 'admin', 'viewer', 'supervisor']);

function resolveRole(claims: JwtClaims): User['role'] | null {
  const candidates = [
    claims['role'],
    claims['https://handover/role'],
    claims['https://handoverpro/role'],
    claims['https://roles'],
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (Array.isArray(candidate)) {
      for (const value of candidate) {
        if (typeof value === 'string' && roleValues.has(value as User['role'])) {
          return value as User['role'];
        }
      }
    } else if (typeof candidate === 'string' && roleValues.has(candidate as User['role'])) {
      return candidate as User['role'];
    }
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveUnitIds(claims: JwtClaims): string[] {
  const candidates = [
    claims['unitIds'],
    claims['units'],
    claims['https://handover/unitIds'],
    claims['https://handoverpro/unitIds'],
  ];
  const collected = new Set<string>();
  for (const candidate of candidates) {
    for (const value of toStringArray(candidate)) {
      collected.add(value);
    }
  }
  return Array.from(collected);
}

function buildUserFromClaims(claims: ValidatedClaims): User {
  const role = resolveRole(claims);
  if (!role) {
    throw new AuthError('TOKEN_INVALID', 'Missing or invalid role claim');
  }
  return {
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    role,
    unitIds: resolveUnitIds(claims),
  };
}

function normalizeAudience(aud: unknown): string[] {
  if (typeof aud === 'string') {
    return [aud];
  }
  if (Array.isArray(aud)) {
    return aud.map((value) => String(value));
  }
  return [];
}

function assertValidClaims(claims: JwtClaims): ValidatedClaims {
  const iss = typeof claims.iss === 'string' ? claims.iss.replace(/\/$/, '') : null;
  const aud = normalizeAudience(claims.aud);
  const expRaw = typeof claims.exp === 'number' ? claims.exp : Number.parseInt(String(claims.exp ?? 'NaN'), 10);
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  if (!iss || !sub || !Number.isFinite(expRaw) || !aud.length) {
    throw new AuthError('TOKEN_INVALID', 'ID token is missing required claims');
  }
  if (iss !== oidcConfig.issuer) {
    throw new AuthError('TOKEN_INVALID', 'ID token issuer mismatch');
  }
    if (!aud.includes(oidcConfig.clientId)) {
    throw new AuthError('TOKEN_INVALID', 'ID token audience mismatch');
  }
  const exp = expRaw;
  if (exp * 1000 <= Date.now()) {
    throw new AuthError('TOKEN_EXPIRED', 'ID token has expired');
  }
  return { ...claims, iss, aud, exp, sub };
}

function validateIdToken(idToken: string): { claims: ValidatedClaims; user: User } {
  const claims = decodeJwtClaims(idToken);
  const validated = assertValidClaims(claims);
  const user = buildUserFromClaims(validated);
  return { claims: validated, user };
}

export async function persistAuth(tokens: AuthTokens, user: User | null): Promise<void> {
  await Promise.all([
    storeSet(ACCESS_KEY, tokens.accessToken),
    storeSet(REFRESH_KEY, tokens.refreshToken ?? null),
    storeSet(EXP_KEY, String(tokens.expiresAt)),
    storeSet(ID_TOKEN_KEY, tokens.idToken ?? null),
    storeSet(USER_KEY, user ? JSON.stringify(user) : null),
  ]);
  setAuthState({ user, tokens });
}

export async function refresh(
  response: AnyTokenResponse,
  user: User | null = null
): Promise<AuthTokens> {
  await hydrateFromStorage();
  const state = getAuthState();
  if (!state.tokens) {
    throw new AuthError('UNAUTHENTICATED', 'Cannot refresh tokens without an existing session');
  }

  const normalized = normalizeTokenResponse(response);
  const accessToken = normalized.accessToken ?? state.tokens.accessToken;
  if (!accessToken) {
    throw new AuthError('TOKEN_INVALID', 'Missing access token in refresh response');
  }

  const baseTokens = buildTokens({
    accessToken,
    refreshToken: normalized.refreshToken ?? undefined,
    expiresIn: normalized.expiresIn ?? undefined,
    idToken: normalized.idToken ?? state.tokens.idToken ?? undefined,
    scope: normalized.scope ?? undefined,
  });

  const idToken = normalized.idToken ?? state.tokens.idToken;
  if (!idToken) {
    throw new AuthError('TOKEN_INVALID', 'Missing id token in refresh response');
  }
  const { user: validatedUser } = validateIdToken(idToken);
  const tokens: AuthTokens = {
    ...baseTokens,
    refreshToken: normalized.refreshToken ?? state.tokens.refreshToken,
    idToken,
    scope: normalized.scope ?? state.tokens.scope,
  };

  const baseUser = user ?? state.user ?? validatedUser;
  if (baseUser?.sub && baseUser.sub !== validatedUser.sub) {
    throw new AuthError('TOKEN_INVALID', 'User in refresh response does not match existing session');
  }
  const mergedUser: User = {
    ...validatedUser,
    name: baseUser?.name ?? validatedUser.name,
    email: baseUser?.email ?? validatedUser.email,
    unitIds: baseUser?.unitIds?.length ? baseUser.unitIds : validatedUser.unitIds,
    role: baseUser?.role ?? validatedUser.role,
  };
  await persistAuth(tokens, mergedUser);
  return tokens;
}

async function revokeToken(refreshToken: string | null): Promise<void> {
  if (!refreshToken) {
    return;
  }
  try {
    const discovery = await getDiscovery();
    if (!discovery.revocationEndpoint) {
      return;
    }
    await AuthSession.revokeAsync(
      { token: refreshToken, clientId: oidcConfig.clientId },
      discovery
    );
  } catch (error) {
    console.warn('Failed to revoke token', error);
  }
}

async function fetchUserInfo(accessToken: string, discovery: DiscoveryDocument): Promise<User | null> {
  if (!discovery.userInfoEndpoint) {
    return null;
  }
  try {
    const response = await fetch(discovery.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const role = resolveRole(payload);
    if (!role) {
      return null;
    }
    const unitIds = resolveUnitIds(payload);
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!sub) {
      return null;
    }
    return {
      sub,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      role,
      unitIds,
    };
  } catch (error) {
    console.warn('Failed to fetch user info', error);
    return null;
  }
}

function buildTokens(response: TokenResponse): AuthTokens {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.max((response.expiresIn ?? 3600) - TOKEN_EXPIRY_SAFETY_WINDOW, 0);
  return {
    accessToken: response.accessToken ?? '',
    refreshToken: response.refreshToken ?? null,
    expiresAt: now + expiresIn,
    idToken: response.idToken ?? undefined,
    scope: response.scope ?? undefined,
  };
}

function normalizeTokenResponse(response: AnyTokenResponse): TokenResponse {
  return {
    accessToken: response.accessToken ?? response.access_token,
    refreshToken: response.refreshToken ?? response.refresh_token,
    expiresIn: response.expiresIn ?? response.expires_in,
    idToken: response.idToken ?? response.id_token,
    scope: response.scope,
  };
}

async function handleTokenResponse(response: TokenResponse, discovery: DiscoveryDocument): Promise<void> {
  const tokens = buildTokens(response);
  if (!tokens.accessToken) {
    throw new AuthError('TOKEN_INVALID', 'Missing access token in response');
  }
  if (!tokens.idToken) {
    throw new AuthError('TOKEN_INVALID', 'Missing id token in response');
  }
  const { user } = validateIdToken(tokens.idToken);
  const profile = await fetchUserInfo(tokens.accessToken, discovery);
  const mergedUser: User =
    profile && profile.sub === user.sub
      ? {
          ...user,
          name: profile.name ?? user.name,
          email: profile.email ?? user.email,
          unitIds: profile.unitIds.length ? profile.unitIds : user.unitIds,
        }
      : user;
  await persistAuth(tokens, mergedUser);
}

let pendingAuthRequest: AuthRequestLike | null = null;

function createAuthRequest(): AuthRequestLike {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: oidcConfig.redirectScheme, path: 'redirect' });
   if (__DEV__) console.log("OIDC redirectUri =", redirectUri);

  const request = new AuthSession.AuthRequest({
    clientId: oidcConfig.clientId,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    scopes: oidcConfig.scope.split(/\s+/).filter(Boolean),
    redirectUri,
    extraParams: { audience: oidcConfig.audience },
  });
  return request as unknown as AuthRequestLike;
}

export async function loginWithOIDC(): Promise<AuthFlowResult> {
  const discovery = await getDiscovery();
  const request = createAuthRequest();
  pendingAuthRequest = request;
   try {
     if (__DEV__) console.log("[auth] promptAsync starting…", { redirectUri: request.redirectUri });

const result = await request.promptAsync(discovery, { useProxy: false, preferEphemeralSession: true });

if (__DEV__) console.log("[auth] promptAsync result =", result);


    if (result.type === "cancel" || result.type === "dismiss") {
      return { status: "cancelled" };
    }
    if (result.type !== "success" || !result.params?.code) {
      throw new AuthError("CANCELLED", result.params?.error_description ?? "OIDC login cancelled");
    }

    await exchangeCodeForTokens(result.params.code, request, discovery);
    return { status: "success" };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("NETWORK", (error as Error)?.message ?? "OIDC login failed");
  } finally {
    pendingAuthRequest = null;
  }
}

async function exchangeCodeForTokens(
  code: string,
  request: AuthRequestLike,
  discovery: DiscoveryDocument
): Promise<void> {
  const redirectUri = request.redirectUri ?? AuthSession.makeRedirectUri({ scheme: oidcConfig.redirectScheme, path: 'redirect' });
  const extraParams = {
    audience: oidcConfig.audience,
    ...(request.codeVerifier ? { code_verifier: request.codeVerifier } : {}),
  };
  try {
    const tokenResponse = (await AuthSession.exchangeCodeAsync(
      {
        clientId: oidcConfig.clientId,
        code,
        redirectUri,
        extraParams: Object.keys(extraParams).length ? extraParams : undefined,
      },
      discovery
    )) as TokenResponse;
    await handleTokenResponse(tokenResponse, discovery);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('NETWORK', (error as Error)?.message ?? 'Failed to exchange authorization code');
  } finally {
    pendingAuthRequest = null;
  }
}

export async function handleRedirect(url: string): Promise<void> {
  await hydrateFromStorage();
  const request = pendingAuthRequest;
  if (!request) {
    return;
  }
  try {
    const discovery = await getDiscovery();
    const parsed = (AuthSession as unknown as { parse?: (input: string) => { queryParams?: Record<string, string>; params?: Record<string, string> } }).parse?.(url) ??
      { queryParams: {}, params: {} };
    const code = parsed.queryParams?.code ?? parsed.params?.code;
    if (!code) {
      const error = parsed.queryParams?.error_description ?? parsed.params?.error_description;
      throw new AuthError('TOKEN_INVALID', error ?? 'OIDC redirect missing authorization code');
    }
    await exchangeCodeForTokens(code, request, discovery);
  } finally {
    pendingAuthRequest = null;
  }
}

export async function ensureFreshToken(): Promise<string> {
  await hydrateFromStorage();
  const state = getAuthState();
  const tokens = state.tokens;
  if (!tokens) {
    throw new AuthError('UNAUTHENTICATED', 'User is not authenticated');
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - now > 60) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new AuthError('TOKEN_INVALID', 'Refresh token missing');
  }
  const discovery = await getDiscovery();
  const response = (await AuthSession.refreshAsync(
    {
      clientId: oidcConfig.clientId,
      refreshToken: tokens.refreshToken,
      scopes: oidcConfig.scope.split(/\s+/).filter(Boolean),
    },
    discovery
  )) as TokenResponse;
  await handleTokenResponse(response, discovery);
  return getAuthState().tokens?.accessToken ?? '';
}

export async function logout(): Promise<void> {
  await hydrateFromStorage();
  const state = getAuthState();
  await revokeToken(state.tokens?.refreshToken ?? null);
  await Promise.all([
    storeSet(ACCESS_KEY, null),
    storeSet(REFRESH_KEY, null),
    storeSet(EXP_KEY, null),
    storeSet(ID_TOKEN_KEY, null),
    storeSet(USER_KEY, null),
  ]);
  clearAuthState();
  pendingAuthRequest = null;
}

export function resetAuthState(): void {
  hydrationPromise = null;
  hydrated = false;
  pendingAuthRequest = null;
  cachedDiscovery = null;
  discoveryPromise = null;
  memoryStore.clear();
  clearAuthState();
  void Promise.all([
    storeSet(ACCESS_KEY, null),
    storeSet(REFRESH_KEY, null),
    storeSet(EXP_KEY, null),
    storeSet(ID_TOKEN_KEY, null),
    storeSet(USER_KEY, null),
  ]).catch((error) => {
    console.warn('Failed to reset secure storage', error);
  });
}

export function getCurrentUser(): User | null {
  return getAuthState().user;
}

export type PublicAuthProfile = { user: User | null };

export function getPublicProfile(): PublicAuthProfile {
  const user = getAuthState().user;
  return {
    user: user
      ? {
          ...user,
          unitIds: [...user.unitIds],
        }
      : null,
  };
}

export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  callback(getAuthState().user);
  return subscribe((state) => callback(state.user));
}

export async function loginWithMockUser(overrides: Partial<User> = {}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const user: User = {
    sub: overrides.sub ?? 'mock-user',
    name: overrides.name,
    email: overrides.email,
    role: overrides.role ?? 'nurse',
    unitIds: overrides.unitIds ?? ['mock-unit'],
  };
  const tokens: AuthTokens = {
    accessToken: overrides.email ? `mock-${overrides.email}` : 'mock-token',
    refreshToken: null,
    expiresAt: now + 3600,
    idToken: buildMockIdToken(user, now + 3600),
    scope: 'openid profile email',
  };
  await persistAuth(tokens, user);
}

export { getAuthState };

function buildMockIdToken(user: User, exp: number): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: oidcConfig.issuer,
      aud: oidcConfig.clientId,
      exp,
      sub: user.sub,
      role: user.role,
      unitIds: user.unitIds,
      name: user.name,
      email: user.email,
    })
  );
  return `${header}.${payload}.mock`;
}
