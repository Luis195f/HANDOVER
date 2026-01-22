import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';
import type { UserRole } from '@/src/security/auth-types';

export type AuthTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
};

export type AuthUser = {
  id: string;
  name?: string;
  roles?: UserRole[];
  units?: string[];
};

export type AuthProviderResult = {
  tokens: AuthTokens;
  user: AuthUser;
};

export interface AuthProvider {
  login: (params: { username: string; password: string }) => Promise<AuthProviderResult>;
  refresh?: (refreshToken: string) => Promise<AuthTokens>;
}

const STORAGE_NAMESPACE = (process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
);

const TOKEN_KEY = `${STORAGE_NAMESPACE}_auth_tokens`;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

function toIsoExpiresAt(expiresAt: string | number): string {
  if (typeof expiresAt === 'number') {
    const millis = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
    return new Date(millis).toISOString();
  }
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
  }
  return parsed.toISOString();
}

export function isTokenExpired(tokens: AuthTokens | null, nowMs: number = Date.now()): boolean {
  if (!tokens?.expiresAt) return true;
  const expMs = Date.parse(tokens.expiresAt);
  if (!Number.isFinite(expMs)) return true;
  return expMs <= nowMs;
}

export async function storeTokens(tokens: AuthTokens | null): Promise<void> {
  if (!tokens) {
    await secureDeleteItem(TOKEN_KEY);
    return;
  }
  const normalized: AuthTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? undefined,
    expiresAt: toIsoExpiresAt(tokens.expiresAt),
  };
  await secureSetItem(TOKEN_KEY, JSON.stringify(normalized));
}

export async function loadTokens(): Promise<AuthTokens | null> {
  const raw = await secureGetItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthTokens;
    if (!parsed?.accessToken || !parsed.expiresAt) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? undefined,
      expiresAt: toIsoExpiresAt(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await secureDeleteItem(TOKEN_KEY);
}

export function createLocalAuthProvider(): AuthProvider {
  return {
    async login({ username, password }: { username: string; password: string }) {
      const normalizedUser = username.trim();
      if (!normalizedUser || !password) {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (!(normalizedUser === 'demo' && password === 'demo')) {
        throw new Error('INVALID_CREDENTIALS');
      }

      const expiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
      const tokens: AuthTokens = {
        accessToken: `local-${normalizedUser}-${Date.now()}`,
        refreshToken: `local-refresh-${normalizedUser}`,
        expiresAt,
      };
      const user: AuthUser = {
        id: normalizedUser,
        name: normalizedUser,
        roles: ['nurse'],
        units: ['UCI'],
      };
      return { tokens, user };
    },
    async refresh(refreshToken: string) {
      if (!refreshToken.startsWith('local-refresh-')) {
        throw new Error('INVALID_REFRESH_TOKEN');
      }
      const expiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
      return {
        accessToken: `local-refresh-${Date.now()}`,
        refreshToken,
        expiresAt,
      };
    },
  };
}

export async function loginWithProvider(
  provider: AuthProvider,
  params: { username: string; password: string },
): Promise<AuthProviderResult> {
  const result = await provider.login(params);
  await storeTokens(result.tokens);
  return result;
}

export async function refreshWithProvider(
  provider: AuthProvider,
  refreshToken: string,
): Promise<AuthTokens> {
  if (!provider.refresh) {
    throw new Error('REFRESH_UNSUPPORTED');
  }
  const tokens = await provider.refresh(refreshToken);
  await storeTokens(tokens);
  return tokens;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens || isTokenExpired(tokens)) return null;
  return tokens.accessToken;
}

const defaultAuthProvider = createLocalAuthProvider();

export const AuthService = {
  login: (username: string, password: string) => loginWithProvider(defaultAuthProvider, { username, password }),
  refresh: (refreshToken: string) => refreshWithProvider(defaultAuthProvider, refreshToken),
  getAccessToken,
  storeTokens,
  loadTokens,
  clearTokens,
  isTokenExpired,
};

export default AuthService;
