import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'handover://redirect',
  useAutoDiscovery: () => null,
  useAuthRequest: () => [null, null, vi.fn()],
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
vi.mock('@/src/security/AuthService', () => ({
  storeTokens: vi.fn(async () => undefined),
  clearTokens: vi.fn(async () => undefined),
  loadTokens: vi.fn(async () => null),
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('@/src/security/OAuthService', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/OAuthService')>(
    '@/src/security/OAuthService',
  );
  return {
    ...actual,
    loadStoredSession: vi.fn(async () => null),
    storeSession: vi.fn(async () => undefined),
    clearStoredSession: vi.fn(async () => undefined),
  };
});

const clearCapabilitiesCache = vi.fn(async () => undefined);
const fetchCapabilities = vi.fn(async () => ({
  userSub: 'auth0|u1',
  roles: ['nurse'],
  scopes: ['handover:write'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: false,
    canViewAudit: false,
    canSendAuditEvents: true,
    isAdmin: false,
  },
}));

vi.mock('@/src/security/capabilities', () => ({
  clearCapabilitiesCache,
  fetchCapabilities,
  getDemoCapabilities: vi.fn(),
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    Alert: { alert: vi.fn() },
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web },
  };
});

import { AuthProvider, setCurrentSession } from '@/src/security/auth';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuthProvider capabilities cache invalidation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setCurrentSession(null);
  });

  it('limpia cache al cambiar session.userId', async () => {
    create(
      <AuthProvider>
        <></>
      </AuthProvider>,
    );

    await act(async () => {
      await flush();
    });

    await act(async () => {
      await setCurrentSession({
        accessToken: 'token-1',
        userId: 'user-1',
        displayName: 'User 1',
        roles: ['nurse'],
        units: [],
      });
      await flush();
    });

    const callsBeforeSwitch = clearCapabilitiesCache.mock.calls.length;

    await act(async () => {
      await setCurrentSession({
        accessToken: 'token-2',
        userId: 'user-2',
        displayName: 'User 2',
        roles: ['nurse'],
        units: [],
      });
      await flush();
    });

    expect(clearCapabilitiesCache.mock.calls.length).toBe(callsBeforeSwitch + 1);
    expect(fetchCapabilities).toHaveBeenCalledTimes(2);
  });
});
