import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configureFHIRClientMock = vi.fn();
const postBundleMock = vi.fn();

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

vi.mock('expo-modules-core', () => {
  class MockEventEmitter {
    addListener() {}
    removeAllListeners() {}
    removeSubscription() {}
  }

  return {
    NativeModulesProxy: {},
    requireNativeModule: () => ({}),
    requireOptionalNativeModule: () => undefined,
    EventEmitter: MockEventEmitter,
  };
});

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const api = {
    isAvailableAsync: vi.fn(async () => true),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getValueWithKeyAsync: vi.fn(async () => 'mock-key'),
    __reset: () => {
      store.clear();
      api.isAvailableAsync.mockReset();
      api.isAvailableAsync.mockResolvedValue(true);
      api.setItemAsync.mockClear();
      api.getItemAsync.mockClear();
      api.deleteItemAsync.mockClear();
      api.getValueWithKeyAsync.mockClear();
    },
  };

  return {
    ...api,
    default: api,
  };
});

vi.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'https://example.test' } },
    manifest: { extra: { apiBaseUrl: 'https://example.test' } },
  },
}));

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test/fhir',
}));

vi.mock('@/src/lib/fhir-client', () => ({
  __esModule: true,
  configureFHIRClient: (...args: unknown[]) => configureFHIRClientMock(...args),
  postBundle: (...args: unknown[]) => postBundleMock(...args),
}));

async function loadModules() {
  const queue = await import('@/src/lib/queue');
  const offlineQueue = await import('@/src/lib/offlineQueue');
  const syncIndex = await import('@/src/lib/sync/index');
  const syncRuntime = await import('@/src/lib/sync');
  return { queue, offlineQueue, syncIndex, syncRuntime };
}

describe('offline/sync runtime proof', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_CLIENT_SIGNING_ENABLED = 'false';
    configureFHIRClientMock.mockReset();
    postBundleMock.mockReset();

    const { queue, syncRuntime } = await loadModules();
    await queue.clearOfflineQueue();
    await queue.clearTxQueue();
    syncRuntime.stopSyncEngine();
  });

  afterEach(async () => {
    const { queue, syncRuntime } = await loadModules();
    await queue.clearOfflineQueue();
    await queue.clearTxQueue();
    syncRuntime.stopSyncEngine();
    vi.unstubAllGlobals();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.EXPO_PUBLIC_CLIENT_SIGNING_ENABLED;
    delete process.env.NODE_ENV;
  });

  it('stores HandoverForm bundles in tx_queue while SyncCenter and PatientList read a different offline queue', async () => {
    const { queue, offlineQueue } = await loadModules();
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] } as const;

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-runtime-proof' });
    const txQueue = await queue.getQueueSnapshot();
    const uiQueue = await queue.listOfflineQueue();
    const adaptedQueue = await offlineQueue.readQueue();

    expect(txQueue).toHaveLength(1);
    expect(txQueue[0]?.key).toBe(queued.key);
    expect(txQueue[0]?.payload).toMatchObject({
      resourceType: 'Bundle',
      type: 'transaction',
    });

    expect(uiQueue).toHaveLength(0);
    expect(adaptedQueue).toHaveLength(0);
  });

  it('sync.ts forceSync ignores HandoverForm tx_queue items because it only inspects the offline queue', async () => {
    const { queue, syncRuntime } = await loadModules();
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] } as const;
    const sender = vi.fn(async () => ({ ok: true as const }));

    await queue.enqueueBundle(bundle, { patientId: 'pat-sync-runtime' });
    syncRuntime.configureSyncEngine({
      getToken: async () => 'token',
      sender,
      isOnline: async () => true,
    });
    const snapshot = await syncRuntime.forceSync();

    expect(sender).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.pendingCount).toBe(0);
    expect(await queue.getQueueSnapshot()).toHaveLength(1);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });

  it('sync/index.ts flush used by SyncCenter also ignores HandoverForm tx_queue items', async () => {
    const { queue, syncIndex } = await loadModules();
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] } as const;

    await queue.enqueueBundle(bundle, { patientId: 'pat-sync-center' });
    const result = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test/fhir',
      getToken: async () => 'token',
      backoff: { retries: 1, minMs: 1, maxMs: 1 },
    });

    expect(configureFHIRClientMock).toHaveBeenCalled();
    expect(postBundleMock).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, remaining: 0 });
    expect(await queue.getQueueSnapshot()).toHaveLength(1);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });

  it('the legacy tx_queue can be drained only through queue.flushQueue', async () => {
    const { queue } = await loadModules();
    const sender = vi.fn(async () => ({ ok: true as const, status: 201 }));
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] } as const;

    await queue.enqueueBundle(bundle, { patientId: 'pat-legacy-drain' });
    await queue.flushQueue(sender, { baseDelayMs: 0 });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(await queue.getQueueSnapshot()).toHaveLength(0);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });
});
