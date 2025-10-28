import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import {
  clearQueue,
  enqueueTxFromValues,
  flushQueue,
  readQueueState,
} from '@/src/lib/sync';

describe('sync.ts offline queue retries', () => {
  beforeEach(async () => {
    (globalThis as any).__secureStoreMem = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await clearQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reintenta con backoff y trata 409 como entregado sin duplicar', async () => {
    await enqueueTxFromValues({ patientId: 'pat-001' } as any);

    const onSent = vi.fn();
    const sender = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('offline');
      })
      .mockImplementationOnce(async () => ({ ok: false, status: 409 }));

    await flushQueue({ sender, onSent });

    let state = await readQueueState();
    expect(state.size).toBe(1);
    expect(state.items[0].attempts).toBe(1);

    const readyTs = new Date(state.items[0].nextAttemptAt).getTime() + 1;
    vi.setSystemTime(new Date(readyTs));

    await flushQueue({ sender, onSent });

    state = await readQueueState();
    expect(state.size).toBe(0);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ patientId: 'pat-001' });
    expect(sender).toHaveBeenCalledTimes(2);
  });
});
