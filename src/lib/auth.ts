import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import { clearAuthState, getAuthState, setAuthState, subscribe, type AuthTokens } from '@/src/state/auth-store';

export type { AuthTokens } from '@/src/state/auth-store';

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
  ) => Promise<{ type: 'success' | 'dismiss' | 'cancel'; params?: Record<string, any> }>;
};

export type User = {
  sub: string;
  name?: string;
  email?: string;
  role: 'nurse' | 'admin' | 'viewer';
  unitIds: string[];
};

type SecureStoreModule = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

function loadSecureStore(): SecureStoreModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-secure-store');
    const resolved = mod?.default ?? mod;
    if (resolved?.getItemAsync && resolved?.setItemAsync && resolved?.deleteItemAsync) {
      return resolved as SecureStoreModule;
    }
  } catch (error) {
    console.warn('expo-secure-store unavailable, falling back to in-memory storage for tests', error);
  }
  return null;
}

const secureStore = loadSecureStore();
const memoryStore = new Map<string, string>();

const TOKEN_EXPIRY_SAFETY_WINDOW = 5;

async function storeSet(key: string, value: string | null): Promise<void> {
  if (!value) {
    if (secureStore) {
      await secureStore.deleteItemAsync(key);
    }
    memoryStore.delete(key);
    return;
  }
  if (secureStore) {
    await secureStore.setItemAsync(key, value);
  } else {
    memoryStore.set(key, value);
  }
}

async function storeGet(key: string): Promise<string | null> {
  if (secureStore) {
    return secureStore.getItemAsync(key);
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
  return explicit ?? 'handover';
}

type OIDCConfig = {
  issuer: string;
  clientId: string;
  audience?: string;
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

function loadOIDCConfig(): OIDCConfig {
  const issuer = readEnv('OIDC_ISSUER');
  const clientId = readEnv('OIDC_CLIENT_ID');
  const scope = readEnv('OIDC_SCOPE') ?? 'openid profile email offline_access';
  const redirectScheme = readEnv('OIDC_REDIRECT_SCHEME') ?? 'handoverpro';
  if (!issuer || !clientId) {
    throw new Error('Missing OIDC configuration');
  }
  const audience = readEnv('OIDC_AUDIENCE');
  return { issuer: issuer.replace(/\/$/, ''), clientId, audience, scope, redirectScheme };
}

const oidcConfig = loadOIDCConfig();

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
      const tokens: AuthTokens = {
        accessToken,
        refreshToken: refreshToken ?? null,
        expiresAt,
        idToken: idToken ?? undefined,
      };
      let user: User | null = null;
      if (userJson) {
        try {
          const parsed = JSON.parse(userJson) as User;
          user = parsed;
        } catch (error) {
          console.warn('Failed to parse stored user', error);
        }
      }
      setAuthState({ user, tokens });
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
  throw new Error('No base64 decoder available');
}

function decodeJwtClaims(idToken: string): Record<string, unknown> | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) {
      return null;
    }
    const payload = decodeBase64Url(parts[1]);
    return JSON.parse(payload) as Record<string, unknown>;
  } catch (error) {
    console.warn('Failed to decode id token', error);
    return null;
  }
}

const roleValues = new Set<User['role']>(['nurse', 'admin', 'viewer']);

function resolveRole(claims: Record<string, unknown> | null): User['role'] {
  if (!claims) {
    return 'viewer';
  }
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
  return 'viewer';
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

function resolveUnitIds(claims: Record<string, unknown> | null): string[] {
  if (!claims) {
    return [];
  }
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

function buildUserFromClaims(claims: Record<string, unknown> | null): User | null {
  if (!claims) {
    return null;
  }
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) {
    return null;
  }
  return {
    sub,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    role: resolveRole(claims),
    unitIds: resolveUnitIds(claims),
  };
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
    throw new Error('Cannot refresh tokens without an existing session');
  }

  const normalized = normalizeTokenResponse(response);
  const accessToken = normalized.accessToken ?? state.tokens.accessToken;
  if (!accessToken) {
    throw new Error('Missing access token in refresh response');
  }

  const baseTokens = buildTokens({
    accessToken,
    refreshToken: normalized.refreshToken ?? undefined,
    expiresIn: normalized.expiresIn ?? undefined,
    idToken: normalized.idToken ?? undefined,
    scope: normalized.scope ?? undefined,
  });

  const tokens: AuthTokens = {
    ...baseTokens,
    refreshToken: normalized.refreshToken ?? state.tokens.refreshToken,
    idToken: normalized.idToken ?? state.tokens.idToken,
    scope: normalized.scope ?? state.tokens.scope,
  };

  const nextUser = user ?? state.user;
  await persistAuth(tokens, nextUser);
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
    throw new Error('Missing access token in response');
  }
  const claims = tokens.idToken ? decodeJwtClaims(tokens.idToken) : null;
  let user = buildUserFromClaims(claims);
  if (!user) {
    user = await fetchUserInfo(tokens.accessToken, discovery);
  }
  if (!user) {
    throw new Error('Unable to resolve user profile from token response');
  }
  await persistAuth(tokens, user);
}

let pendingAuthRequest: AuthRequestLike | null = null;

function createAuthRequest(): AuthRequestLike {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: oidcConfig.redirectScheme });
  const request = new AuthSession.AuthRequest({
    clientId: oidcConfig.clientId,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    scopes: oidcConfig.scope.split(/\s+/).filter(Boolean),
    redirectUri,
    extraParams: oidcConfig.audience ? { audience: oidcConfig.audience } : undefined,
  }) as unknown as AuthRequestLike;
  return request;
}

export async function loginWithOIDC(): Promise<void> {
  const discovery = await getDiscovery();
  const request = createAuthRequest();
  pendingAuthRequest = request;
  try {
    const result = await request.promptAsync(discovery, { useProxy: false });
    if (result.type !== 'success' || !result.params?.code) {
      throw new Error(result.params?.error_description ?? 'OIDC login cancelled');
    }
    await exchangeCodeForTokens(result.params.code, request, discovery);
  } finally {
    pendingAuthRequest = null;
  }
}

async function exchangeCodeForTokens(
  code: string,
  request: AuthRequestLike,
  discovery: DiscoveryDocument
): Promise<void> {
  const redirectUri = request.redirectUri ?? AuthSession.makeRedirectUri({ scheme: oidcConfig.redirectScheme });
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId: oidcConfig.clientId,
      code,
      redirectUri,
      extraParams: oidcConfig.audience ? { audience: oidcConfig.audience } : undefined,
    },
    discovery,
    { code_verifier: request.codeVerifier }
  ) as TokenResponse;
  await handleTokenResponse(tokenResponse, discovery);
  pendingAuthRequest = null;
}

export async function handleRedirect(url: string): Promise<void> {
  await hydrateFromStorage();
  const request = pendingAuthRequest;
  if (!request) {
    return;
  }
  try {
    const discovery = await getDiscovery();
    const parsed = AuthSession.parse(url);
    const code = parsed.queryParams?.code ?? parsed.params?.code;
    if (!code) {
      const error = parsed.queryParams?.error_description ?? parsed.params?.error_description;
      throw new Error(error ?? 'OIDC redirect missing authorization code');
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
    throw new Error('User is not authenticated');
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - now > 60) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error('Refresh token missing');
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

  if (secureStore) {
    void Promise.all([
      secureStore.deleteItemAsync(ACCESS_KEY),
      secureStore.deleteItemAsync(REFRESH_KEY),
      secureStore.deleteItemAsync(EXP_KEY),
      secureStore.deleteItemAsync(ID_TOKEN_KEY),
      secureStore.deleteItemAsync(USER_KEY),
    ]).catch((error) => {
      console.warn('Failed to reset secure storage', error);
    });
  }
}

export function getCurrentUser(): User | null {
  return getAuthState().user;
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
    idToken: undefined,
    scope: 'openid profile email',
  };
  await persistAuth(tokens, user);
}

export { getAuthState };
