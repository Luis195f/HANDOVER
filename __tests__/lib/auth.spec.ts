import * as SecureStore from 'expo-secure-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshAsync = vi.fn();
const revokeAsync = vi.fn();
const fetchDiscoveryAsync = vi.fn();
const makeRedirectUri = vi.fn(() => 'handover://redirect');

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('expo-auth-session', () => ({
  refreshAsync: (...args: unknown[]) => refreshAsync(...args),
  revokeAsync: (...args: unknown[]) => revokeAsync(...args),
  fetchDiscoveryAsync: (...args: unknown[]) => fetchDiscoveryAsync(...args),
  makeRedirectUri: (...args: unknown[]) => makeRedirectUri(...args),
  AuthRequest: vi.fn(),
  ResponseType: { Code: 'code' },
  exchangeCodeAsync: vi.fn(),
  parse: vi.fn(() => ({ queryParams: {}, params: {} })),
}));

vi.mock('expo-constants', () => ({
  expoConfig: { extra: {} },
}));

describe('auth token helpers', () => {
  const originalIssuer = process.env.EXPO_PUBLIC_OIDC_ISSUER;
  const originalClientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;
  const originalScope = process.env.EXPO_PUBLIC_OIDC_SCOPE;
  const originalNamespace = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.test';
    process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client-123';
    process.env.EXPO_PUBLIC_OIDC_SCOPE = 'openid profile offline_access';
    process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = 'handover';

    fetchDiscoveryAsync.mockResolvedValue({
      tokenEndpoint: 'https://issuer.test/token',
      revocationEndpoint: 'https://issuer.test/revoke',
    });
    refreshAsync.mockResolvedValue({});
    revokeAsync.mockResolvedValue(undefined);
    makeRedirectUri.mockReturnValue('handover://redirect');

    (SecureStore.getItemAsync as any).mockReset?.();
    (SecureStore.setItemAsync as any).mockReset?.();
    (SecureStore.deleteItemAsync as any).mockReset?.();
    (SecureStore.setItemAsync as any).mockResolvedValue?.(undefined);
    (SecureStore.deleteItemAsync as any).mockResolvedValue?.(undefined);
  });

  afterEach(() => {
    if (originalIssuer === undefined) delete process.env.EXPO_PUBLIC_OIDC_ISSUER;
    else process.env.EXPO_PUBLIC_OIDC_ISSUER = originalIssuer;
    if (originalClientId === undefined) delete process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;
    else process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = originalClientId;
    if (originalScope === undefined) delete process.env.EXPO_PUBLIC_OIDC_SCOPE;
    else process.env.EXPO_PUBLIC_OIDC_SCOPE = originalScope;
    if (originalNamespace === undefined) delete process.env.EXPO_PUBLIC_STORAGE_NAMESPACE;
    else process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = originalNamespace;
  });

  it('refresh cuando expira en <60s', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ sub: 'nurse-1', name: 'Nurse Jane', role: 'nurse', unitIds: ['icu'] })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const idToken = `e30.${payload}.signature`;

    (SecureStore.getItemAsync as any)
      .mockResolvedValueOnce('old_access')
      .mockResolvedValueOnce('refresh123')
      .mockResolvedValueOnce(String(now + 30))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    refreshAsync.mockResolvedValue({
      accessToken: 'new_access',
      refreshToken: 'refresh123',
      expiresIn: 180,
      idToken,
    });

    const { ensureFreshToken } = await import('@/src/lib/auth');

    const token = await ensureFreshToken();

    expect(refreshAsync).toHaveBeenCalledWith(
      {
        clientId: 'client-123',
        refreshToken: 'refresh123',
        scopes: expect.arrayContaining(['openid']),
      },
      expect.objectContaining({ tokenEndpoint: 'https://issuer.test/token' })
    );
    expect(token).toBe('new_access');
    expect(SecureStore.setItemAsync as any).toHaveBeenCalledWith(
      'handover:auth:access',
      'new_access',
      expect.any(Object)
    );
  });

  it('logout borra tokens y revoca refresh token', async () => {
    const now = Math.floor(Date.now() / 1000);

    (SecureStore.getItemAsync as any)
      .mockResolvedValueOnce('access_logout')
      .mockResolvedValueOnce('refresh_logout')
      .mockResolvedValueOnce(String(now + 3600))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        JSON.stringify({ sub: 'nurse-1', role: 'nurse', unitIds: ['icu'] })
      );

    const { logout } = await import('@/src/lib/auth');

    await logout();

    expect(revokeAsync).toHaveBeenCalledWith(
      { token: 'refresh_logout', clientId: 'client-123' },
      expect.objectContaining({ revocationEndpoint: 'https://issuer.test/revoke' })
    );
    expect(SecureStore.deleteItemAsync as any).toHaveBeenCalledTimes(5);
  });
});
