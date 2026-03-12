import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearQueue,
  enqueueTxFromValues,
  flushQueue,
  readQueueState,
} from '@/src/lib/sync';

describe('sync.ts mixed delivery and idempotency', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    await clearQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retains recoverable failures and only clears delivered drafts', async () => {
    await enqueueTxFromValues({ patientId: 'pat-ok' } as any);
    await enqueueTxFromValues({ patientId: 'pat-retry' } as any);

    const onSent = vi.fn();
    const sender = vi.fn(async (tx) => {
      if (tx.patientId === 'pat-ok') {
        return { ok: false as const, status: 201 };
      }
      return { ok: false as const, status: 503, message: 'upstream timeout' };
    });

    const result = await flushQueue({ sender, onSent });
    const state = await readQueueState();

    expect(result).toEqual({ total: 2, sent: 1, skipped: 1 });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ patientId: 'pat-ok' });
    expect(state.size).toBe(1);
    expect(state.items[0]?.patientId).toBe('pat-retry');
    expect(state.items[0]?.attempts).toBe(1);
    expect(state.items[0]?.lastError).toBe('HTTP 503');
  });

  it('coalesces repeated enqueue for the same patient into one pending item', async () => {
    await enqueueTxFromValues({ patientId: 'pat-dedupe' } as any);

    const firstState = await readQueueState();
    const firstCreatedAt = firstState.items[0]?.createdAt;
    const firstTxId = firstState.items[0]?.txId;

    vi.setSystemTime(new Date('2025-01-01T01:00:00.000Z'));
    await enqueueTxFromValues({ patientId: 'pat-dedupe' } as any);

    const secondState = await readQueueState();

    expect(secondState.size).toBe(1);
    expect(secondState.items[0]?.patientId).toBe('pat-dedupe');
    expect(secondState.items[0]?.createdAt).toBe(firstCreatedAt);
    expect(secondState.items[0]?.txId).toBe(firstTxId);
    expect(new Date(secondState.items[0]?.updatedAt ?? '').toISOString()).toBe(
      '2025-01-01T01:00:00.000Z',
    );
  });
});
