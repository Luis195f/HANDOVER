import * as SecureStore from 'expo-secure-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshAsync = vi.fn();
const revokeAsync = vi.fn();
const fetchDiscoveryAsync = vi.fn();
const makeRedirectUri = vi.fn(() => 'handover://redirect');
const exchangeCodeAsync = vi.fn();
const AuthRequestCtor = vi.fn(function AuthRequest(this: any, params: Record<string, unknown> = {}) {
  Object.assign(this, params);
  this.promptAsync = promptAsync;
  this.codeVerifier = params.codeVerifier ?? 'code-verifier';
  this.redirectUri = params.redirectUri ?? 'handover://redirect';
  return this;
});
const parse = vi.fn(() => ({ queryParams: {}, params: {} }));
const promptAsync = vi.fn();

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}), { virtual: true });

vi.mock('expo-auth-session', () => ({
  refreshAsync: (...args: unknown[]) => refreshAsync(...args),
  revokeAsync: (...args: unknown[]) => revokeAsync(...args),
  fetchDiscoveryAsync: (...args: unknown[]) => fetchDiscoveryAsync(...args),
  makeRedirectUri: (...args: unknown[]) => makeRedirectUri(...args),
  AuthRequest: AuthRequestCtor,
  ResponseType: { Code: 'code' },
  exchangeCodeAsync: (...args: unknown[]) => exchangeCodeAsync(...args),
  parse: (...args: unknown[]) => parse(...args),
}));

vi.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
  expoConfig: { extra: {} },
}));

describe('auth token helpers', () => {
  const originalIssuer = process.env.EXPO_PUBLIC_OIDC_ISSUER;
  const originalClientId = process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;
  const originalScope = process.env.EXPO_PUBLIC_OIDC_SCOPE;
  const originalAudience = process.env.EXPO_PUBLIC_OIDC_AUDIENCE;
  const originalRedirectScheme = process.env.EXPO_PUBLIC_OIDC_REDIRECT_SCHEME;
  const originalNamespace = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.EXPO_PUBLIC_OIDC_ISSUER = 'https://issuer.test';
    process.env.EXPO_PUBLIC_OIDC_CLIENT_ID = 'client-123';
    process.env.EXPO_PUBLIC_OIDC_SCOPE = 'openid profile offline_access';
    process.env.EXPO_PUBLIC_OIDC_AUDIENCE = 'api://handover';
    process.env.EXPO_PUBLIC_OIDC_REDIRECT_SCHEME = 'handoverpro';
    process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = 'handover';

    fetchDiscoveryAsync.mockResolvedValue({
      tokenEndpoint: 'https://issuer.test/token',
      revocationEndpoint: 'https://issuer.test/revoke',
    });
    refreshAsync.mockResolvedValue({});
    revokeAsync.mockResolvedValue(undefined);
    makeRedirectUri.mockReturnValue('handover://redirect');
    exchangeCodeAsync.mockResolvedValue({});
    AuthRequestCtor.mockClear();
    promptAsync.mockReset();
    parse.mockReturnValue({ queryParams: {}, params: {} });

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
    if (originalAudience === undefined) delete process.env.EXPO_PUBLIC_OIDC_AUDIENCE;
    else process.env.EXPO_PUBLIC_OIDC_AUDIENCE = originalAudience;
    if (originalRedirectScheme === undefined) delete process.env.EXPO_PUBLIC_OIDC_REDIRECT_SCHEME;
    else process.env.EXPO_PUBLIC_OIDC_REDIRECT_SCHEME = originalRedirectScheme;
    if (originalNamespace === undefined) delete process.env.EXPO_PUBLIC_STORAGE_NAMESPACE;
    else process.env.EXPO_PUBLIC_STORAGE_NAMESPACE = originalNamespace;
  });

  const buildIdToken = (claims: Record<string, unknown> = {}): string => {
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://issuer.test',
        aud: 'api://handover',
        exp: Math.floor(Date.now() / 1000) + 600,
        sub: 'nurse-1',
        role: 'nurse',
        unitIds: ['icu'],
        ...claims,
      })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `e30.${payload}.signature`;
  };

  it('falla con error de configuración cuando falta una variable crítica', async () => {
    delete process.env.EXPO_PUBLIC_OIDC_CLIENT_ID;
    vi.resetModules();

    await expect(import('@/src/lib/auth')).rejects.toMatchObject({
      kind: 'CONFIG',
      message: expect.stringContaining('OIDC_CLIENT_ID'),
    });
  });

  it('loginWithOIDC devuelve cancelado sin persistir tokens', async () => {
    promptAsync.mockResolvedValue({ type: 'cancel' });
    AuthRequestCtor.mockReturnValue({ promptAsync, codeVerifier: 'verifier', redirectUri: 'handover://redirect' } as any);

    const { loginWithOIDC } = await import('@/src/lib/auth');
    const result = await loginWithOIDC();

    expect(result).toEqual({ status: 'cancelled' });
    expect(exchangeCodeAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync as any).not.toHaveBeenCalled();
  });

  it('loginWithOIDC intercambia código y persiste sesión válida', async () => {
    const idToken = buildIdToken();
    promptAsync.mockResolvedValue({ type: 'success', params: { code: 'auth-code' } });
    AuthRequestCtor.mockReturnValue({ promptAsync, codeVerifier: 'verifier', redirectUri: 'handover://redirect' } as any);
    exchangeCodeAsync.mockResolvedValue({ accessToken: 'new_access', refreshToken: 'refresh123', expiresIn: 1200, idToken });

    const { loginWithOIDC, getCurrentUser, getAuthState } = await import('@/src/lib/auth');
    const result = await loginWithOIDC();

    expect(result).toEqual({ status: 'success' });
    expect(AuthRequestCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-123',
        scopes: expect.arrayContaining(['openid', 'profile', 'offline_access']),
      })
    );
    expect(exchangeCodeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-123',
        code: 'auth-code',
        extraParams: expect.objectContaining({ audience: 'api://handover', code_verifier: 'verifier' }),
      }),
      expect.any(Object)
    );
    expect(getCurrentUser()).toMatchObject({ sub: 'nurse-1', role: 'nurse', unitIds: ['icu'] });
    expect(getAuthState().tokens?.idToken).toBe(idToken);
  });

  it('refresh cuando expira en <60s', async () => {
    const now = Math.floor(Date.now() / 1000);
    const idToken = buildIdToken();
    refreshAsync.mockResolvedValue({
      accessToken: 'new_access',
      refreshToken: 'refresh123',
      expiresIn: 180,
      idToken,
    });

    const { ensureFreshToken, persistAuth, getAuthState } = await import('@/src/lib/auth');
    await persistAuth(
      {
        accessToken: 'old_access',
        refreshToken: 'refresh123',
        expiresAt: now + 30,
        idToken,
      },
      { sub: 'nurse-1', role: 'nurse', unitIds: ['icu'] }
    );

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
    expect(getAuthState().tokens?.accessToken).toBe('new_access');
  });

  it('acepta audience que coincida con clientId o audience configurado', async () => {
    const now = Math.floor(Date.now() / 1000) + 600;
    const { persistAuth, refresh, getAuthState } = await import('@/src/lib/auth');
    await persistAuth(
      {
        accessToken: 'existing',
        refreshToken: 'refresh123',
        expiresAt: now,
        idToken: buildIdToken({ aud: ['client-123', 'extra'] }),
      },
      {
        sub: 'nurse-1',
        role: 'nurse',
        unitIds: ['icu'],
      }
    );

    const freshIdToken = buildIdToken({ aud: ['other', 'api://handover'] });
    const tokens = await refresh({ access_token: 'fresh', refresh_token: 'refresh123', expires_in: 1200, id_token: freshIdToken });
    expect(tokens.accessToken).toBe('fresh');
    expect(getAuthState().tokens?.idToken).toBe(freshIdToken);
  });

  it('rechaza sesión almacenada expirada', async () => {
    const idToken = buildIdToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    const { ensureFreshToken, getAuthState, persistAuth } = await import('@/src/lib/auth');
    await persistAuth(
      {
        accessToken: 'old_access',
        refreshToken: 'refresh123',
        expiresAt: Math.floor(Date.now() / 1000) - 5,
        idToken,
      },
      { sub: 'nurse-1', role: 'nurse', unitIds: ['icu'] }
    );

    await expect(ensureFreshToken()).rejects.toMatchObject({ kind: 'UNAUTHENTICATED' });
    expect(getAuthState().tokens).toBeNull();
  });

  it('rechaza id token con audience incorrecto durante refresh', async () => {
    const validIdToken = buildIdToken();
    const { persistAuth, refresh } = await import('@/src/lib/auth');
    await persistAuth(
      {
        accessToken: 'existing',
        refreshToken: 'refresh123',
        expiresAt: Math.floor(Date.now() / 1000) + 500,
        idToken: validIdToken,
      },
      {
        sub: 'nurse-1',
        role: 'nurse',
        unitIds: ['icu'],
      }
    );

    await expect(
      refresh({ access_token: 'fresh', refresh_token: 'refresh123', expires_in: 1200, id_token: buildIdToken({ aud: 'wrong' }) })
    ).rejects.toMatchObject({ kind: 'TOKEN_INVALID' });
  });

  it('public profile expone solo datos no sensibles', async () => {
    const idToken = buildIdToken();
    const { persistAuth, getPublicProfile } = await import('@/src/lib/auth');
    await persistAuth(
      {
        accessToken: 'existing',
        refreshToken: 'refresh123',
        expiresAt: Math.floor(Date.now() / 1000) + 500,
        idToken,
      },
      {
        sub: 'nurse-1',
        role: 'nurse',
        unitIds: ['icu'],
        name: 'Nurse Jane',
      }
    );

    const profile = getPublicProfile();
    expect(profile).toEqual({
      user: { sub: 'nurse-1', role: 'nurse', unitIds: ['icu'], name: 'Nurse Jane' },
    });
    expect(profile).not.toHaveProperty('tokens');
  });

  it('logout borra tokens y revoca refresh token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const idToken = buildIdToken({ exp: now + 3600 });

    const { logout, persistAuth, getAuthState } = await import('@/src/lib/auth');

    await persistAuth(
      {
        accessToken: 'access_logout',
        refreshToken: 'refresh_logout',
        expiresAt: now + 3600,
        idToken,
      },
      { sub: 'nurse-1', role: 'nurse', unitIds: ['icu'] }
    );

    await logout();

    expect(revokeAsync).toHaveBeenCalledWith(
      { token: 'refresh_logout', clientId: 'client-123' },
      expect.objectContaining({ revocationEndpoint: 'https://issuer.test/revoke' })
    );
    expect(getAuthState().tokens).toBeNull();
  });
});
