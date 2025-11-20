import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));

const secureStoreState: { value: string | null } = { value: null };
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => secureStoreState.value),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    secureStoreState.value = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    secureStoreState.value = null;
  }),
}));

const promptAsyncMock = vi.fn();
const discoveryMock = vi.fn();

vi.mock('expo-auth-session', () => ({
  ResponseType: { Code: 'code' },
  AuthRequest: class {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
    promptAsync = promptAsyncMock;
  },
  fetchDiscoveryAsync: discoveryMock,
  makeRedirectUri: vi.fn(() => 'app://redirect'),
}));

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({
    sub: 'user-123',
    name: 'Nurse Example',
    roles: ['nurse'],
    units: ['icu-a'],
  }),
}));

globalThis.fetch = fetchMock as unknown as typeof fetch;

describe('auth session', () => {
  beforeEach(() => {
    secureStoreState.value = null;
    promptAsyncMock.mockReset();
    discoveryMock.mockResolvedValue({
      authorizationEndpoint: 'https://example/authorize',
      tokenEndpoint: 'https://example/token',
      userInfoEndpoint: 'https://example/userinfo',
    });
    promptAsyncMock.mockResolvedValue({
      type: 'success',
      authentication: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        issuedAt: 1700000000,
        expiresIn: 1200,
      },
    });
  });

  it('loginWithOAuth stores session and hydrates current session', async () => {
    const { getCurrentSession, loginWithOAuth } = await import('@/src/security/auth');

    const session = await loginWithOAuth();
    expect(session.accessToken).toBe('access-token');
    expect(session.roles).toContain('nurse');
    expect(session.units).toEqual(['icu-a']);

    const hydrated = await getCurrentSession();
    expect(hydrated?.userId).toBe('user-123');
  });

  it('logout clears persisted session', async () => {
    const { getCurrentSession, loginWithOAuth, logout } = await import('@/src/security/auth');

    await loginWithOAuth();
    await logout();
    const session = await getCurrentSession();
    expect(session).toBeNull();
    expect(secureStoreState.value).toBeNull();
  });
});
