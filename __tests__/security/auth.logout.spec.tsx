import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-auth-session', () => ({
  AuthRequest: vi.fn(),
  ResponseType: { Code: 'code' },
  exchangeCodeAsync: vi.fn(),
  fetchDiscoveryAsync: vi.fn(async () => ({
    authorizationEndpoint: 'https://auth.test/authorize',
    tokenEndpoint: 'https://auth.test/token',
  })),
  makeRedirectUri: vi.fn(() => 'handover://logout'),
  useAuthRequest: () => [{ codeVerifier: 'verifier' }, null, vi.fn()],
  useAutoDiscovery: () => ({
    authorizationEndpoint: 'https://auth.test/authorize',
    tokenEndpoint: 'https://auth.test/token',
  }),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn().mockResolvedValue({ type: 'success' }),
}));

const secureGetItem = vi.fn();
const secureSetItem = vi.fn();
const secureDeleteItem = vi.fn();

vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem,
  secureSetItem,
  secureDeleteItem,
}));

const resetTo = vi.fn();
vi.mock('@/src/navigation/navigation', () => ({
  __esModule: true,
  resetTo,
  default: { resetTo },
}));

vi.mock('@/src/demo/fixtures', () => ({
  ensureDemoSessionTemplate: vi.fn(() => null),
}));

describe('logout flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('borra sesión segura y navega al login', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { setCurrentSession, logoutAndClear } = await import('@/src/security/auth');

    await setCurrentSession({
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      expiresAt: new Date().toISOString(),
      userId: 'nurse-1',
      displayName: 'Nurse 1',
      roles: ['nurse'],
      units: ['UCI'],
    });

    await logoutAndClear({ skipRemote: true, message: 'Sesión expirada, inicia sesión de nuevo' });

    expect(secureDeleteItem).toHaveBeenCalled();
    expect(resetTo).toHaveBeenCalledWith('Login');
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
