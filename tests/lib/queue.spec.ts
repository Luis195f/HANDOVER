import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resetEnv = () => {
  delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
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

  it('stores payloads encrypted (or wrapped) and returns decrypted content', async () => {
    const cryptoModule = await import('@/src/lib/crypto');
    const encryptSpy = vi
      .spyOn(cryptoModule, 'encryptPayload')
      .mockImplementation(async (plaintext) => `enc:${plaintext}`);
    const decryptSpy = vi
      .spyOn(cryptoModule, 'decryptPayload')
      .mockImplementation(async (ciphertext) =>
        typeof ciphertext === 'string' && ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext
      );

    const queue = await loadQueue();
    const payload = { hello: 'world' };
    await queue.enqueueTx({ key: 'enc-test', payload });

    const snapshot = await queue.getQueueSnapshot();
    expect(encryptSpy).toHaveBeenCalled();
    expect(decryptSpy).toHaveBeenCalled();
    expect(snapshot[0]?.payload).toEqual(payload);
  });
});
