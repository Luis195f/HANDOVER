// __mocks__/expo-auth-session.ts
import { vi } from 'vitest';

export type AuthRequestConfig = {
  clientId: string;
  scopes?: string[];
  redirectUri: string;
  responseType?: string;
};

export class AuthRequest {
  config: AuthRequestConfig;

  constructor(config: AuthRequestConfig) {
    this.config = config;
  }

  async makeAuthUrlAsync(): Promise<string> {
    return 'https://example.org/auth';
  }

  // Simula que el usuario completó correctamente el login y devuelve un "code"
  async promptAsync(_discovery: any): Promise<{ type: 'success' | 'error'; params?: { code?: string } }> {
    return { type: 'success', params: { code: 'auth-code-123' } };
  }
}

export const makeRedirectUri = vi.fn((_opts?: any) => 'https://example.org/callback');

export const fetchDiscoveryAsync = vi.fn(async (_issuer: string) => ({
  issuer: 'https://example.org',
  authorizationEndpoint: 'https://example.org/auth',
  tokenEndpoint: 'https://example.org/token',
  revocationEndpoint: 'https://example.org/revoke',
}));

export const exchangeCodeAsync = vi.fn(async (_params: any, _discovery: any) => ({
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-456',
  idToken: 'id-token-789',
  tokenType: 'Bearer',
  expiresIn: 3600,
}));

// Por si algún componente usa el hook:
export const useAuthRequest = vi.fn((config: any, discovery: any) => {
  const req = new AuthRequest(config);
  const result = null;
  const promptAsync = vi.fn(async () => ({ type: 'success', params: { code: 'auth-code-123' } }));
  return [req, result, promptAsync] as const;
});

