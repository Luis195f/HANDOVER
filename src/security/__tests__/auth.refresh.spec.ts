import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'handover://redirect',
  ResponseType: { Code: 'code' },
}));
vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => undefined,
}));
vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: vi.fn(async () => null),
  secureSetItem: vi.fn(async () => undefined),
  secureDeleteItem: vi.fn(async () => undefined),
}));
vi.mock('@/src/security/secure-cleanup', () => ({
  clearSensitiveLocalData: vi.fn(async () => undefined),
}));
vi.mock('@/src/navigation/navigation', () => ({
  resetTo: vi.fn(),
}));
vi.mock('@/src/security/AuthService', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/AuthService')>(
    '@/src/security/AuthService',
  );
  const storeTokens = vi.fn(async () => undefined);
  const clearTokens = vi.fn(async () => undefined);
  const loadTokens = vi.fn(async () => null);
  const getAccessToken = vi.fn(async () => null);
  return {
    ...actual,
    default: {
      ...actual.default,
      storeTokens,
      clearTokens,
      loadTokens,
      getAccessToken,
    },
    storeTokens,
    clearTokens,
    loadTokens,
    getAccessToken,
  };
});
vi.mock('@/src/security/capabilities', () => ({
  clearCapabilitiesCache: vi.fn(async () => undefined),
  fetchCapabilities: vi.fn(async () => null),
  getDemoCapabilities: () => ({
    userSub: 'demo',
    roles: [],
    scopes: [],
    permissions: {
      canWriteHandover: false,
      canSignHandover: false,
      canViewAudit: false,
      canSendAuditEvents: false,
      isAdmin: false,
    },
  }),
}));
vi.mock('@/src/demo/fixtures', () => ({
  ensureDemoSessionTemplate: () => ({
    userId: 'demo',
    displayName: 'Demo',
    roles: [],
    units: [],
  }),
}));
vi.mock('@/src/security/OAuthService', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/OAuthService')>(
    '@/src/security/OAuthService',
  );
  return {
    ...actual,
    refreshTokens: vi.fn(),
    storeSession: vi.fn(async () => undefined),
    loadStoredSession: vi.fn(async () => null),
    clearStoredSession: vi.fn(async () => undefined),
  };
});

import { ensureFreshToken, setCurrentSession } from '@/src/security/auth';
import { refreshTokens } from '@/src/security/OAuthService';
import { resetTo } from '@/src/navigation/navigation';

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildJwt(expSeconds: number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ exp: expSeconds }));
  return `${header}.${payload}.`;
}

describe('ensureFreshToken', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setCurrentSession(null);
  });

  it('refreshes when token is expiring soon', async () => {
    const expSoon = Math.floor(Date.now() / 1000) + 60;
    const accessToken = buildJwt(expSoon);
    const refreshToken = 'refresh-token';

    (refreshTokens as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    await setCurrentSession({
      accessToken,
      refreshToken,
      userId: 'user-1',
      displayName: 'User',
      roles: ['nurse'],
      units: [],
    });

    const token = await ensureFreshToken();

    expect(refreshTokens).toHaveBeenCalledWith(refreshToken);
    expect(token).toBe('new-access');
  });

  it('logs out when refresh fails', async () => {
    const expSoon = Math.floor(Date.now() / 1000) + 60;
    const accessToken = buildJwt(expSoon);
    const refreshToken = 'refresh-token';

    (refreshTokens as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    await setCurrentSession({
      accessToken,
      refreshToken,
      userId: 'user-2',
      displayName: 'User',
      roles: ['nurse'],
      units: [],
    });

    const token = await ensureFreshToken();

    expect(token).toBeNull();
    expect(resetTo).toHaveBeenCalledWith('Login');
  });
});
