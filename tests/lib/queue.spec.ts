import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 1) Mock de expo-sqlite: así `queue.ts` usa el fallback in-memory
vi.mock('expo-sqlite', () => {
  return {
    
    openDatabaseSync: undefined,
    openDatabase: undefined,
  };
});

// 2) Mock de expo-modules-core: por si algo lo llega a importar
vi.mock('expo-modules-core', () => {
  class MockEventEmitter {
    addListener() {}
    removeAllListeners() {}
    removeSubscription() {}
  }

  return {
    NativeModulesProxy: {},
    requireNativeModule: () => ({}),
    EventEmitter: MockEventEmitter,
  };
});

const resetEnv = () => {
  delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
  delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
  delete process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS;
};

const loadQueue = async () => {
  const queue = await import('@/src/lib/queue');
  await queue.clearTxQueue();
  return queue;
};

describe('tx queue (sqlite + fallback)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(async () => {
    const queue = await import('@/src/lib/queue');
    await queue.clearTxQueue();
    vi.restoreAllMocks();
    resetEnv();
  });

  it('enqueues and returns items in FIFO order', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    const queue = await loadQueue();

    const first = await queue.enqueueTx({ key: 'fifo-1', payload: { idx: 1 } });
    const second = await queue.enqueueTx({ key: 'fifo-2', payload: { idx: 2 } });

    const snapshot = await queue.getQueueSnapshot();
    expect(snapshot.map((item) => item.key)).toEqual([first.key, second.key]);
    expect(snapshot[0]?.status).toBe('pending');
  });

  it('increments retryCount after a transient failure', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    const queue = await loadQueue();

    const key = 'retry-once';
    await queue.enqueueTx({ key, payload: { attempt: 0 } });

    const sender = vi.fn(async () => ({ ok: false, status: 503 }));
    await queue.flushQueue(sender, { maxRetries: 0, baseDelayMs: 0 });

    const snapshot = await queue.getQueueSnapshot();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(snapshot[0]?.attempts).toBe(1);
    expect(snapshot[0]?.retryCount).toBe(1);
  });

  it('mantiene el item en cola ante 502/503/504 y programa backoff', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    const queue = await loadQueue();

    const key = 'gateway-error';
    await queue.enqueueTx({ key, payload: { attempt: 0 } });

    const sender = vi
      .fn(async () => ({ ok: false, status: 502 }))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 504 });

    await queue.flushQueue(sender, { maxRetries: 2, baseDelayMs: 1000 });

    const snapshot = await queue.getQueueSnapshot();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.attempts).toBe(3);
    expect(snapshot[0]?.nextRetryAt).toBeGreaterThan(Date.now());
  });

  it('elimina definitivamente tras errores 4xx', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    const queue = await loadQueue();

    await queue.enqueueTx({ key: 'bad-request', payload: { foo: 'bar' } });

    const sender = vi.fn(async () => ({ ok: false, status: 400 }));
    await queue.flushQueue(sender, { baseDelayMs: 0 });

    const snapshot = await queue.getQueueSnapshot();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveLength(0);
  });

  it('respects max attempts configured via env by stopping after the configured retries', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS = '1';
    const queueModule = await loadQueue();

    const key = 'env-max';
    await queueModule.enqueueTx({ key, payload: { willFail: true } });

    const sender = vi.fn(async () => ({ ok: false, status: 503 }));
    await queueModule.flushQueue(sender, { baseDelayMs: 0 });

    expect(sender).toHaveBeenCalledTimes(2);
    const snapshot = await queueModule.getQueueSnapshot();
    expect(snapshot[0]?.status).toBe('failed');
    expect(snapshot[0]?.attempts).toBeGreaterThanOrEqual(2);
  });

  it('stores encrypted payloads when encryption flag is off and decrypts on read', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key';
    const queue = await loadQueue();

    const bundle = { resourceType: 'Bundle', id: 'test' };
    await queue.enqueueTx({ key: 'enc-enabled', payload: bundle });

    const rawRows = await queue.__getRawTxQueueRows();
    expect(rawRows).toHaveLength(1);
    const stored = rawRows[0]?.payload ?? '';
    expect(stored).not.toContain('"Bundle"');
    const envelope = JSON.parse(stored);
    expect(envelope).toMatchObject({ v: 1, algo: 'AES-256-GCM' });
    expect(typeof envelope.ct).toBe('string');
    expect(typeof envelope.iv).toBe('string');

    const snapshot = await queue.getQueueSnapshot();
    expect(snapshot[0]?.payload).toEqual(bundle);
  });

  it('stores plaintext payloads when encryption is disabled and reads them back', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key';
    const queue = await loadQueue();

    const bundle = { resourceType: 'Bundle', id: 'plain' };
    await queue.enqueueTx({ key: 'enc-disabled', payload: bundle });

    const rawRows = await queue.__getRawTxQueueRows();
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]?.payload).toContain('"plain"');

    const snapshot = await queue.getQueueSnapshot();
    expect(snapshot[0]?.payload).toEqual(bundle);
  });

  it('reads legacy plaintext entries without errors even when encryption is enabled', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key';
    const queue = await loadQueue();

    const bundle = { resourceType: 'Bundle', id: 'legacy' };
    await queue.enqueueTx({ key: 'legacy-item', payload: bundle });

    // Activar cifrado para la lectura
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';

    const snapshot = await queue.getQueueSnapshot();
    expect(snapshot[0]?.payload).toEqual(bundle);
  });
});
