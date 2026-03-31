import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

vi.mock('@/src/lib/fhir-client', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/fhir-client')>('@/src/lib/fhir-client');
  return {
    ...actual,
    postBundle: vi.fn(),
  };
});

describe('offline sync single source of truth', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';

    const queue = await import('@/src/lib/queue');
    await queue.clearOfflineQueue();
    await queue.clearTxQueue();

    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.NODE_ENV;
  });

  it('processQueueOnce drains the same canonical queue item enqueued by queue.enqueueBundle', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-sync-ts' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    await queue.enqueueBundle(bundle, { patientId: 'pat-sync-ts' });
    const storedBundle = ((await queue.listOfflineQueue())[0]?.payload as { bundle?: unknown } | undefined)?.bundle;

    const sender = vi.fn(async (item: { payload: { bundle?: unknown } }) => {
      expect(item.payload.bundle).toEqual(storedBundle);
      return { ok: true as const, status: 200 };
    });

    sync.setQueueSendHandler(sender);
    await sync.processQueueOnce();
    await sync.processQueueOnce();

    expect(sender).toHaveBeenCalledTimes(1);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(await queue.__getRawTxQueueRows()).toHaveLength(0);
  });

  it('sync/index flushes the same canonical queue item without duplicating the send', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const syncIndex = await import('@/src/lib/sync/index');
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-sync-index' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-sync-index' });
    const storedBundle = ((await queue.listOfflineQueue())[0]?.payload as { bundle?: unknown } | undefined)?.bundle;
    (client.postBundle as unknown as Mock).mockResolvedValue({ ok: true, status: 200 });

    const first = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
    });
    expect(syncIndex.consumeRecentlySyncedQueueItem(queued.id)).toBe(true);
    expect(syncIndex.consumeRecentlySyncedQueueItem(queued.id)).toBe(false);

    const second = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
    });

    expect(first).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(second).toEqual({ processed: 0, remaining: 0, outcome: 'success', status: undefined });
    expect(client.postBundle).toHaveBeenCalledTimes(1);
    expect(client.postBundle).toHaveBeenCalledWith(
      storedBundle,
      expect.objectContaining({
        headers: { 'Idempotency-Key': queued.id },
      }),
    );
    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(await queue.__getRawTxQueueRows()).toHaveLength(0);
  });
});
