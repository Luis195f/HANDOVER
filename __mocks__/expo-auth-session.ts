export type AuthSessionResult = { type: 'success' | 'cancel' | 'error'; params?: Record<string, string>; errorCode?: string };

export async function startAsync(): Promise<AuthSessionResult> {
  return { type: 'cancel' };
}

export async function fetchDiscoveryAsync() {
  return {
    authorizationEndpoint: 'https://example.com/auth',
    tokenEndpoint: 'https://example.com/token',
  };
}

export async function exchangeCodeAsync() {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 3600,
    idToken: 'id-token',
    issuedAt: Date.now() / 1000,
  };
}

export default {
  startAsync,
  fetchDiscoveryAsync,
  exchangeCodeAsync,
};
