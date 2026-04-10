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
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';

    const queue = await import('@/src/lib/queue');
    await queue.clearOfflineQueue();
    await queue.clearTxQueue();

    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
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
        idempotencyKey: queued.id,
        headers: expect.objectContaining({ Prefer: 'return=representation' }),
      }),
    );
    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(await queue.__getRawTxQueueRows()).toHaveLength(0);
  });

  it('sync/index consumes a 409 idempotent replay as delivered and removes the canonical queue item', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const syncIndex = await import('@/src/lib/sync/index');
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-sync-index-409' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-sync-index-409' });
    (client.postBundle as unknown as Mock).mockResolvedValue({ ok: false, status: 409, body: {} });

    const result = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
      backoff: { retries: 0, minMs: 0, maxMs: 0 },
    });

    expect(result).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(syncIndex.consumeRecentlySyncedQueueItem(queued.id)).toBe(true);
    expect(client.postBundle).toHaveBeenCalledTimes(1);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(await queue.__getRawTxQueueRows()).toHaveLength(0);
  });

  it('sync/index leaves transport status 0 pending in the canonical queue for the sync runtime backoff', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const syncIndex = await import('@/src/lib/sync/index');
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-sync-index-network' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-sync-index-network' });
    (client.postBundle as unknown as Mock)
      .mockResolvedValueOnce({ ok: false, status: 0, body: { error: 'network down' } })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
      backoff: { retries: 1, minMs: 0, maxMs: 0 },
    });

    expect(result).toEqual({ processed: 0, remaining: 1, outcome: 'network-error', status: 0 });
    expect(syncIndex.consumeRecentlySyncedQueueItem(queued.id)).toBe(false);
    expect(client.postBundle).toHaveBeenCalledTimes(1);
    const [pending] = await queue.listOfflineQueue();
    expect(pending?.id).toBe(queued.id);
    expect(pending?.syncStatus).toBe('pending');
  });

  it('sync/index reports 403 replays as auth-failed and keeps the item terminal in the canonical queue', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const syncIndex = await import('@/src/lib/sync/index');
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-sync-index-403' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-sync-index-403' });
    (client.postBundle as unknown as Mock).mockResolvedValue({ ok: false, status: 403, body: { error: 'forbidden' } });

    const result = await syncIndex.flushQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
      backoff: { retries: 0, minMs: 0, maxMs: 0 },
    });

    const [failed] = await queue.listOfflineQueue();
    expect(result).toEqual({ processed: 0, remaining: 1, outcome: 'auth-failed', status: 403 });
    expect(syncIndex.consumeRecentlySyncedQueueItem(queued.id)).toBe(false);
    expect(failed?.id).toBe(queued.id);
    expect(failed?.syncStatus).toBe('error');
    expect(failed?.errorStatus).toBe(403);
  });

  it('canonical flush coalesces concurrent callers so a pending row is sent only once', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-concurrent-flush' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });

    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-concurrent-flush' });
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    (client.postBundle as unknown as Mock).mockImplementationOnce(async () => {
      await inFlight;
      return { ok: true, status: 200 };
    });

    const flushA = sync.flushSyncQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
    });
    const flushB = sync.flushSyncQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'token',
    });

    release();
    const [resultA, resultB] = await Promise.all([flushA, flushB]);

    expect(resultA).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(resultB).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(client.postBundle).toHaveBeenCalledTimes(1);
    expect(sync.consumeRecentlySyncedQueueItem(queued.id)).toBe(true);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });

  it('getCanonicalQueueSize returns -1 when the canonical queue read fails', async () => {
    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const listSpy = vi.spyOn(queue, 'listOfflineQueue').mockRejectedValueOnce(new Error('read failed'));

    await expect(sync.getCanonicalQueueSize()).resolves.toBe(-1);

    listSpy.mockRestore();
  });
});

