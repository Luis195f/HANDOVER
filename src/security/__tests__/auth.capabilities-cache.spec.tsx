import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const capabilityMocks = vi.hoisted(() => ({
  clearCapabilitiesCache: vi.fn(async () => undefined),
  fetchCapabilities: vi.fn(async () => ({
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
  })),
}));

vi.mock('@/src/security/capabilities', () => ({
  clearCapabilitiesCache: capabilityMocks.clearCapabilitiesCache,
  fetchCapabilities: capabilityMocks.fetchCapabilities,
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

import { AuthProvider, getCurrentSession, setCurrentSession } from '@/src/security/auth';
import { resetTo } from '@/src/navigation/navigation';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AuthProvider capabilities cache invalidation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setCurrentSession(null);
  });

  it('limpia cache al cambiar session.userId', async () => {
    await act(async () => {
      create(
        <AuthProvider>
          <></>
        </AuthProvider>,
      );
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

    const callsBeforeSwitch = capabilityMocks.clearCapabilitiesCache.mock.calls.length;

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

    expect(capabilityMocks.clearCapabilitiesCache.mock.calls.length).toBe(callsBeforeSwitch + 1);
    expect(capabilityMocks.fetchCapabilities).toHaveBeenCalledTimes(2);
  });

  it('ignora un 401 tardio de una sesion vieja y conserva la sesion activa', async () => {
    const staleFailure = deferred<never>();
    capabilityMocks.fetchCapabilities
      .mockImplementationOnce(() => staleFailure.promise)
      .mockImplementationOnce(async () => ({
        userSub: 'auth0|u2',
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

    let renderer: ReturnType<typeof create> | null = null;

    await act(async () => {
      renderer = create(
        <AuthProvider>
          <></>
        </AuthProvider>,
      );
      await flush();
    });

    await act(async () => {
      await setCurrentSession({
        accessToken: 'token-1',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        userId: 'user-1',
        displayName: 'User 1',
        roles: ['nurse'],
        units: [],
      });
      await flush();
    });

    await act(async () => {
      await setCurrentSession({
        accessToken: 'token-2',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        userId: 'user-2',
        displayName: 'User 2',
        roles: ['nurse'],
        units: [],
      });
      await flush();
      await flush();
    });

    await act(async () => {
      staleFailure.reject(Object.assign(new Error('401 Unauthorized'), { status: 401 }));
      await flush();
      await flush();
    });

    await expect(getCurrentSession()).resolves.toMatchObject({ userId: 'user-2' });
    expect(resetTo).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  });
});

