import * as SecureStore from 'expo-secure-store';

export type User = {
  sub: string;
  name?: string;
  role?: 'nurse' | 'admin' | 'viewer';
  unitIds: string[];
  email?: string;
};

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};

const KEY = 'auth/tokens';

export async function getTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

export async function setTokens(t: Tokens) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(t));
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEY);
}

export async function ensureFreshToken(): Promise<string> {
  const t = await getTokens();
  if (!t?.access_token) throw new Error('NOT_AUTHENTICATED');

  const skewMs = 60_000;
  if (Date.now() < t.expires_at - skewMs) return t.access_token;

  if (!t.refresh_token) throw new Error('NO_REFRESH_TOKEN');

  const issuer = process.env.EXPO_PUBLIC_OIDC_ISSUER!;
  const clientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID!;
  const audience = process.env.EXPO_PUBLIC_OIDC_AUDIENCE ?? undefined;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: clientId,
  });
  if (audience) body.set('audience', audience);

  const resp = await fetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) throw new Error(`REFRESH_FAILED ${resp.status}`);
  const j = await resp.json();
  const next: Tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? t.refresh_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  await setTokens(next);
  return next.access_token;
}

export async function logout() {
  await clearTokens();
}

export type { Tokens };

export async function loginWithMockUser() {
  await setTokens({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_at: Date.now() + 3600 * 1000,
  });
}
