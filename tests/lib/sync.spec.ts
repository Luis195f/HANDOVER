import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postBundleMock = vi.fn();

vi.mock('@/src/lib/fhir-client', () => ({
  __esModule: true,
  postBundle: (...args: unknown[]) => postBundleMock(...args),
}));

import * as queueModule from '@/src/lib/queue';
import {
  __getRawOfflineQueueRows,
  __getRawTxQueueRows,
  clearOfflineQueue,
  createOfflineQueueItem,
  listOfflineQueue,
} from '@/src/lib/queue';
import {
  configureSyncEngine,
  forceSync,
  getSyncSnapshot,
  getNextDelayMs,
  resumeSync,
  stopSyncEngine,
} from '@/src/lib/sync';
import type { Bundle } from '@/src/lib/fhir-client';

// ======================================================
// 🧩 EXPO BASE MOCKS AND DEPENDENCIES
// ======================================================

// Mock expo-sqlite (avoid native requirements)
vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

// Mock expo-modules-core
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

// Mock expo-constants (avoid Node errors)
vi.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'https://example.test' } },
    manifest: { extra: { apiBaseUrl: 'https://example.test' } },
  },
}));

// Mock FHIR_BASE_URL environment
vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));
vi.mock('@/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));

// Full mock of expo-secure-store
vi.mock('expo-secure-store', () => {
  const api = {
    getItemAsync: vi.fn().mockResolvedValue(null),
    setItemAsync: vi.fn().mockResolvedValue(undefined),
    deleteItemAsync: vi.fn().mockResolvedValue(undefined),
    getValueWithKeyAsync: vi.fn().mockResolvedValue('mock-key'),
  };
  return {
    ...api,
    default: api,
  };
});

// Empty expo mock
vi.mock('expo', () => ({}));

// ======================================================
// ⚙️ SYNC ENGINE TESTS
// ======================================================

describe('sync engine state machine', () => {
  const isOnline = vi.fn<[], Promise<boolean>>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await clearOfflineQueue();
    isOnline.mockResolvedValue(true);
    postBundleMock.mockReset();
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
  });

  afterEach(async () => {
    await clearOfflineQueue();
    await stopSyncEngine();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.NODE_ENV;
  });

  // ======================================================
  // 🔹 TEST 1 — Do not send while offline
  // ======================================================
  it('does not send items while offline and moves into backoff', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    // Simulate offline mode
    isOnline.mockResolvedValue(false);

    await createOfflineQueueItem({ payload: {}, patientId: 'pat-offline' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(1_000);

    // Should not call the sender while offline.
    expect(sender).not.toHaveBeenCalled();

    // Simulate reconnection.
    isOnline.mockResolvedValue(true);
    const delay = getNextDelayMs();
    await vi.advanceTimersByTimeAsync(delay);

    // The engine should move into backoff/offline without sending yet.
    const snapshot = getSyncSnapshot();
    expect(['backoff', 'offline', 'idle']).toContain(snapshot.status);
  });

  // ======================================================
  // 🔹 TEST 2 — Clears the queue after successful delivery
  // ======================================================
  it('clears the queue on successful delivery and reports idle', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    await createOfflineQueueItem({ payload: {}, patientId: 'pat-success' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });

  // ======================================================
  // 🔹 TEST 2.1 — Queues offline and sends each item once on reconnection
  // ======================================================
  it('queues while offline and sends each item once on reconnection', async () => {
    const sentIds: string[] = [];
    const sender = vi.fn(async (item: { id: string; patientId?: string }) => {
      sentIds.push(item.id);
      if (item.patientId === 'pat-error') {
        return { ok: false as const, status: 400, message: 'invalid' };
      }
      return { ok: true as const, status: 200 };
    });

    isOnline.mockResolvedValue(false);

    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-a' });
    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-b' });
    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-error' });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender).not.toHaveBeenCalled();
    expect((await listOfflineQueue()).length).toBe(3);

    isOnline.mockResolvedValue(true);
    await forceSync();

    expect(sender).toHaveBeenCalledTimes(3);
    expect(new Set(sentIds).size).toBe(sentIds.length);

    const remaining = await listOfflineQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.syncStatus).toBe('error');
  });

  // ======================================================
  // 🔹 TEST 3 — Applies backoff after 5xx errors
  // ======================================================
  it('applies backoff after a recoverable 5xx and retries later', async () => {
    const sender = vi
      .fn<[], Promise<{ ok: boolean; status: number }>>()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-backoff',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);
    const delay = getNextDelayMs();
    await vi.advanceTimersByTimeAsync(delay);
    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(2);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
  });

  // ======================================================
  // 🔹 TEST 4 — Keeps pending after 502/504 and preserves the payload
  // ======================================================
  it('keeps pending after 502/504 responses and preserves the payload', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 502 }));

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-gateway',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    const [item] = await listOfflineQueue();

    // It attempted to send at least once.
    expect(sender).toHaveBeenCalled();

    // The item remains pending in the queue.
    expect(item?.syncStatus).toBe('pending');
    expect(item?.attempts).toBeGreaterThanOrEqual(1);

    // "Preserves the payload": data is still present, even if encrypted now.
    expect(item?.payload).toBeTruthy();
    expect(typeof item?.payload).toBe('object');
    expect((item?.payload as { bundle?: unknown }).bundle).toBeDefined();
  });

  // ======================================================
  // 🔹 TEST 5 — Marks items as permanent errors after 4xx
  // ======================================================
  it('marks items after permanent 4xx responses', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 400, message: 'invalid' }));
    isOnline.mockResolvedValue(true);

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-invalid',
      attempts: 0,
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender).toHaveBeenCalled();

    const remaining = await listOfflineQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.syncStatus).toBe('error');
  });

  // ======================================================
  // 🔹 TEST 6 — Pauses after authentication failures
  // ======================================================
  it('pauses sync after authentication failures and resumes when requested', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 401 }));
    isOnline.mockResolvedValue(true);

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-auth',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(getSyncSnapshot().status).toBe('paused');

    resumeSync();
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(2);
    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(1);
  });

  it('marks unreadable offline payloads as errors without deleting them', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    await createOfflineQueueItem({ payload: '{invalid-json', patientId: 'pat-corrupt' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    expect(sender).not.toHaveBeenCalled();

    const [item] = await listOfflineQueue();
    expect(item?.syncStatus).toBe('error');
    expect(item?.attempts).toBe(1);
    expect(item?.errorMessage).toBe('Error al analizar el payload offline');
  });
});

describe('offline encryption integration', () => {
  const isOnline = vi.fn<[], Promise<boolean>>();
  const bundle: Bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await clearOfflineQueue();
    isOnline.mockResolvedValue(true);
    postBundleMock.mockReset();
  });

  afterEach(async () => {
    await clearOfflineQueue();
    await stopSyncEngine();
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.NODE_ENV;
  });

  it('encrypts stored payloads but sends decrypted JSON when encryption is enabled', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });

    await createOfflineQueueItem({ payload: { bundle, txId: 'enc-sync' }, patientId: 'pat-encrypted' });
    const originalList = queueModule.listOfflineQueue;
    const listSpy = vi
      .spyOn(queueModule, 'listOfflineQueue')
      .mockImplementation(async () =>
        (await originalList()).map((item) => ({
          ...item,
          payload: { bundle, txId: 'enc-sync', patientId: 'pat-encrypted' },
        }))
      );

    const rawRows = await __getRawOfflineQueueRows();
    expect(rawRows[0]?.payload).not.toContain('enc-sync');

    configureSyncEngine({ getToken: async () => 'token', isOnline });
    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    listSpy.mockRestore();

    expect(postBundleMock).toHaveBeenCalled();
    const [sentBundle, opts] = postBundleMock.mock.calls.at(-1) ?? [];
    expect(sentBundle).toEqual(bundle);
    expect(opts?.idempotencyKey).toBe('enc-sync');

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });

  it('sends decrypted JSON when encryption is disabled', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });

    await createOfflineQueueItem({ payload: { bundle, txId: 'plain-sync' }, patientId: 'pat-plain' });
    const originalList = queueModule.listOfflineQueue;
    const listSpy = vi
      .spyOn(queueModule, 'listOfflineQueue')
      .mockImplementation(async () =>
        (await originalList()).map((item) => ({
          ...item,
          payload: { bundle, txId: 'plain-sync', patientId: 'pat-plain' },
        }))
      );

    configureSyncEngine({ getToken: async () => 'token', isOnline });
    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    listSpy.mockRestore();

    expect(postBundleMock).toHaveBeenCalled();
    const [sentBundle, opts] = postBundleMock.mock.calls.at(-1) ?? [];
    expect(sentBundle).toEqual(bundle);
    expect(opts?.idempotencyKey).toBe('plain-sync');

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });
});

// ci: retrigger
