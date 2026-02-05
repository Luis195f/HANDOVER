import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

const secureGetItem = vi.fn(async (key: string) => storage.get(key) ?? null);
const secureSetItem = vi.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const secureDeleteItem = vi.fn(async (key: string) => {
  storage.delete(key);
});

const apiGet = vi.fn();

vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem,
  secureSetItem,
  secureDeleteItem,
}));
vi.mock('@/src/lib/api', () => ({ apiGet }));

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
    storage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    await invalidateCapabilitiesCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve cache fresh sin llamar API', async () => {
    storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({ capabilities: baseCapabilities, cachedAt: Date.now() }),
    );

    const result = await fetchCapabilities();

    expect(result).toEqual(baseCapabilities);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('con cache stale refresca y actualiza cache', async () => {
    storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({
        capabilities: baseCapabilities,
        cachedAt: Date.now() - 10 * 60 * 1000,
      }),
    );
    apiGet.mockResolvedValue(refreshedCapabilities);

    const result = await fetchCapabilities();

    expect(apiGet).toHaveBeenCalledWith('/api/me/capabilities');
    expect(result).toEqual(refreshedCapabilities);
    const stored = JSON.parse(storage.get(CAPABILITIES_KEY) ?? '{}') as {
      cachedAt?: number;
      capabilities?: Capabilities;
    };
    expect(stored.capabilities).toEqual(refreshedCapabilities);
    expect(stored.cachedAt).toBe(Date.now());
  });

  it('invalidación borra cache y fuerza fetch remoto', async () => {
    storage.set(
      CAPABILITIES_KEY,
      JSON.stringify({ capabilities: baseCapabilities, cachedAt: Date.now() }),
    );
    await invalidateCapabilitiesCache();
    apiGet.mockResolvedValue(refreshedCapabilities);

    const result = await fetchCapabilities();

    expect(secureDeleteItem).toHaveBeenCalledWith(CAPABILITIES_KEY);
    expect(apiGet).toHaveBeenCalledWith('/api/me/capabilities');
    expect(result).toEqual(refreshedCapabilities);
  });
});
