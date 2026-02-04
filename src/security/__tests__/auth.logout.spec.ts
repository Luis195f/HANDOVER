import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'handover://redirect',
}));
vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => undefined,
  openAuthSessionAsync: async () => ({ type: 'success' }),
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
  clearTokens: vi.fn(async () => undefined),
}));
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
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    Alert: { alert: vi.fn() },
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web },
  };
});

import { logoutAndClear } from '@/src/security/auth';
import { clearSensitiveLocalData } from '@/src/security/secure-cleanup';
import { resetTo } from '@/src/navigation/navigation';

describe('logoutAndClear', () => {
  it('clears sensitive data on logout', async () => {
    await logoutAndClear({ skipRemote: true });

    expect(clearSensitiveLocalData).toHaveBeenCalled();
    expect(resetTo).toHaveBeenCalledWith('Login');
  });
});
