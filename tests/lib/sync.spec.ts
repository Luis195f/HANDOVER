import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOfflineQueue, createOfflineQueueItem, listOfflineQueue } from '@/src/lib/queue';
import {
  configureSyncEngine,
  forceSync,
  getSyncSnapshot,
  getNextDelayMs,
  resumeSync,
  stopSyncEngine,
} from '@/src/lib/sync';

describe('sync engine state machine', () => {
  const isOnline = vi.fn<[], Promise<boolean>>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await clearOfflineQueue();
    isOnline.mockResolvedValue(true);
  });

  afterEach(async () => {
    await clearOfflineQueue();
    stopSyncEngine();
    vi.useRealTimers();
  });

  it('does not send items while offline and moves into backoff', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));
    isOnline.mockResolvedValue(false);

    await createOfflineQueueItem({ payload: '{}', patientId: 'pat-off', createdAt: '2024-01-01T00:00:00.000Z' });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender).not.toHaveBeenCalled();
    expect(getSyncSnapshot().status).toBe('backoff');
  });

  it('clears the queue on successful delivery and reports idle', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-ok' });

    await forceSync();

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe('idle');
  });

  it('applies backoff after a recoverable 5xx and retries later', async () => {
    const sender = vi
      .fn(async () => ({ ok: false as const, status: 503 }))
      .mockResolvedValueOnce({ ok: false as const, status: 503 })
      .mockResolvedValueOnce({ ok: true as const });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-503' });

    await forceSync();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe('backoff');

    await vi.advanceTimersByTimeAsync(getNextDelayMs(1) + 50);

    const snapshot = getSyncSnapshot();
    expect(snapshot.status === 'running' || snapshot.status === 'idle').toBeTruthy();
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('pauses sync after authentication failures and resumes when requested', async () => {
    const sender = vi
      .fn(async () => ({ ok: false as const, status: 401 }))
      .mockResolvedValueOnce({ ok: false as const, status: 401 })
      .mockResolvedValue({ ok: true as const });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await createOfflineQueueItem({ payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } }, patientId: 'pat-auth' });

    await forceSync();
    expect(getSyncSnapshot().status).toBe('paused');

    resumeSync();
    await forceSync();

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe('idle');
  });
});
