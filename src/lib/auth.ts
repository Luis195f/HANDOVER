export { AuthProvider, useAuth } from './auth-context';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  idToken?: string | null;
  scope?: string;
};

export type AuthUser = {
  id: string;
  name?: string;
  [key: string]: unknown;
};

export type AuthState = {
  tokens: AuthTokens | null;
  user: AuthUser | null;
};

let currentState: AuthState = {
  tokens: null,
  user: null,
};

export function getAuthState(): AuthState {
  return currentState;
}

export async function persistAuth(tokens: AuthTokens, user: AuthUser | null): Promise<void> {
  currentState = { tokens, user };
}

export function resetAuthState(): void {
  currentState = { tokens: null, user: null };
}

type OidcTokenResponse = {
  accessToken?: string | null;
  access_token?: string | null;
  refreshToken?: string | null;
  refresh_token?: string | null;
  expiresIn?: number | null;
  expires_in?: number | null;
  idToken?: string | null;
  id_token?: string | null;
  scope?: string | null;
};

export async function refresh(resp: OidcTokenResponse, user: AuthUser | null): Promise<AuthTokens> {
  const prevRefresh = getAuthState()?.tokens?.refreshToken ?? null;

  const tokens: AuthTokens = {
    accessToken: resp.accessToken ?? resp.access_token ?? '',
    refreshToken: resp.refreshToken ?? resp.refresh_token ?? prevRefresh,
    expiresAt: (() => {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = resp.expiresIn ?? resp.expires_in ?? 3600;
      return now + expiresIn - 5;
    })(),
    idToken: resp.idToken ?? resp.id_token ?? undefined,
    scope: resp.scope ?? 'openid profile email',
  };

  await persistAuth(tokens, user);
  return tokens;
}
