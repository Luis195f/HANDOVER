import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ENCRYPTION_PREFIX } from '@/src/lib/crypto';
import {
  clearOfflineQueue,
  createOfflineQueueItem,
  listOfflineQueue,
  updateOfflineQueueItem,
} from '@/src/lib/queue';
import { processQueueOnce, setQueueSendHandler } from '@/src/lib/sync';

vi.mock('expo-secure-store');

const secureStore = SecureStore as typeof SecureStore & { __reset?: () => void };

describe('offline queue encryption', () => {
  beforeEach(async () => {
    secureStore.__reset?.();
    await SecureStore.setItemAsync('handover_offline_queue_key', 'test-key-123');
    await clearOfflineQueue();
    setQueueSendHandler(async () => ({ ok: true }));
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';
  });

  it('cifra el payload al encolar un bundle', async () => {
    const payload = { resourceType: 'Bundle', marker: 'SECRET-VALUE-12345' };

    await createOfflineQueueItem({ payload, patientId: 'pat-enc' });

    const [stored] = await listOfflineQueue();
    expect(stored?.payload.startsWith(ENCRYPTION_PREFIX)).toBe(true);
    expect(stored?.payload).not.toContain('SECRET-VALUE-12345');
  });

  it('procesa registros legacy sin cifrar y los migra', async () => {
    const legacyPayload = { foo: 'bar', nested: { value: 1 } };
    const created = await createOfflineQueueItem({
      payload: '{}',
      patientId: 'pat-legacy',
      createdAt: new Date(Date.now() - 70_000).toISOString(),
    });

    await updateOfflineQueueItem(created.id, { payload: JSON.stringify(legacyPayload) });

    let sentPayload: unknown;
    setQueueSendHandler(async (item) => {
      sentPayload = item.payload;
      return { ok: true } as const;
    });

    await processQueueOnce();

    expect(sentPayload).toEqual(legacyPayload);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
  });
});
