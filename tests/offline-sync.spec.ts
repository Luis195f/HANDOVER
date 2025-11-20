import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearOfflineQueue,
  createOfflineQueueItem,
  listOfflineQueue,
  summarizePatientQueueState,
  type QueueItem,
} from '@/src/lib/queue';
import { getNextDelayMs, processQueueOnce, setQueueSendHandler } from '@/src/lib/sync';

describe('offline backoff policy', () => {
  it('follows the expected exponential steps', () => {
    expect(getNextDelayMs(0)).toBe(60_000);
    expect(getNextDelayMs(1)).toBe(5 * 60_000);
    expect(getNextDelayMs(2)).toBe(15 * 60_000);
    expect(getNextDelayMs(3)).toBe(60 * 60_000);
    expect(getNextDelayMs(8)).toBe(60 * 60_000);
  });
});

describe('offline queue processing', () => {
  beforeEach(async () => {
    await clearOfflineQueue();
    setQueueSendHandler(async () => ({ ok: true }));
  });

  it('moves pending items to synced after a successful send', async () => {
    await createOfflineQueueItem({
      payload: '{}',
      patientId: 'pat-success',
      createdAt: new Date(Date.now() - 70_000).toISOString(),
    });

    await processQueueOnce();

    const [item] = await listOfflineQueue();
    expect(item?.syncStatus).toBe('synced');
    expect(item?.attempts).toBe(1);
  });

  it('marks permanent failures with error status', async () => {
    setQueueSendHandler(async () => ({ ok: false, status: 400, message: 'invalid bundle' }));
    await createOfflineQueueItem({
      payload: '{}',
      patientId: 'pat-error',
      createdAt: new Date(Date.now() - 70_000).toISOString(),
    });

    await processQueueOnce();

    const [item] = await listOfflineQueue();
    expect(item?.syncStatus).toBe('error');
    expect(item?.errorMessage).toContain('invalid bundle');
    expect(item?.attempts).toBe(1);
  });
});

describe('patient sync status aggregation', () => {
  it('prioritizes error over pending and synced states', () => {
    const items: QueueItem[] = [
      {
        id: 'a',
        createdAt: new Date().toISOString(),
        attempts: 1,
        syncStatus: 'synced',
        payloadType: 'handover-bundle',
        payload: '{}',
        patientId: 'pat-1',
      },
      {
        id: 'b',
        createdAt: new Date().toISOString(),
        attempts: 2,
        syncStatus: 'pending',
        payloadType: 'handover-bundle',
        payload: '{}',
        patientId: 'pat-1',
        lastAttemptAt: new Date().toISOString(),
      },
      {
        id: 'c',
        createdAt: new Date().toISOString(),
        attempts: 3,
        syncStatus: 'error',
        payloadType: 'handover-bundle',
        payload: '{}',
        patientId: 'pat-1',
      },
    ];

    expect(summarizePatientQueueState(items)).toBe('error');
  });
});
