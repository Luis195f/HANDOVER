import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    secureGetItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    secureSetItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    secureDeleteItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    apiGet: vi.fn(),
  };
});

vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: mockState.secureGetItem,
  secureSetItem: mockState.secureSetItem,
  secureDeleteItem: mockState.secureDeleteItem,
}));
vi.mock('@/src/lib/api', () => ({ apiGet: mockState.apiGet }));

import {
  fetchCapabilities,
  invalidateCapabilitiesCache,
  type Capabilities,
} from '@/src/security/capabilities';

const CAPABILITIES_KEY = `${(process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
)}_capabilities`;

const baseCapabilities: Capabilities = {
  userSub: 'auth0|nurse',
  roles: ['nurse'],
  scopes: ['handover:write'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: false,
    canViewAudit: false,
    canSendAuditEvents: true,
    isAdmin: false,
  },
};

const refreshedCapabilities: Capabilities = {
  userSub: 'auth0|nurse',
  roles: ['nurse'],
  scopes: ['handover:write', 'audit:read'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: false,
    canViewAudit: true,
    canSendAuditEvents: true,
    isAdmin: false,
  },
};

describe('capabilities cache TTL', () => {
  beforeEach(async () => {
    mockState.storage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    await invalidateCapabilitiesCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve cache fresh sin llamar API', async () => {
    mockState.storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({ capabilities: baseCapabilities, cachedAt: Date.now() }),
    );

    const result = await fetchCapabilities();

    expect(result).toEqual(baseCapabilities);
    expect(mockState.apiGet).not.toHaveBeenCalled();
  });

  it('con cache stale refresca y actualiza cache', async () => {
    mockState.storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({
        capabilities: baseCapabilities,
        cachedAt: Date.now() - 10 * 60 * 1000,
      }),
    );
    mockState.apiGet.mockResolvedValue(refreshedCapabilities);

    const result = await fetchCapabilities();

    expect(mockState.apiGet).toHaveBeenCalledWith('/api/me/capabilities');
    expect(result).toEqual(refreshedCapabilities);
    const stored = JSON.parse(mockState.storage.get(CAPABILITIES_KEY) ?? '{}') as {
      cachedAt?: number;
      capabilities?: Capabilities;
    };
    expect(stored.capabilities).toEqual(refreshedCapabilities);
    expect(stored.cachedAt).toBe(Date.now());
  });

  it('invalida cache cuando /api/me/capabilities responde 403', async () => {
    mockState.storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({ capabilities: baseCapabilities, cachedAt: Date.now() - 10 * 60 * 1000 }),
    );
    mockState.apiGet.mockRejectedValue(new Error('403 Forbidden'));

    await expect(fetchCapabilities()).rejects.toThrow('403 Forbidden');

    expect(mockState.apiGet).toHaveBeenCalledWith('/api/me/capabilities');
    expect(mockState.secureDeleteItem).toHaveBeenCalledWith(CAPABILITIES_KEY);
  });

  it('invalidación borra cache y fuerza fetch remoto', async () => {
    mockState.storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({ capabilities: baseCapabilities, cachedAt: Date.now() }),
    );
    await invalidateCapabilitiesCache();
    mockState.apiGet.mockResolvedValue(refreshedCapabilities);

    const result = await fetchCapabilities();

    expect(mockState.secureDeleteItem).toHaveBeenCalledWith(CAPABILITIES_KEY);
    expect(mockState.apiGet).toHaveBeenCalledWith('/api/me/capabilities');
    expect(result).toEqual(refreshedCapabilities);
  });
});
