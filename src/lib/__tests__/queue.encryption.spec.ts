import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOfflineQueue,
  createOfflineQueueItem,
  listOfflineQueue,
  updateOfflineQueueItem,
} from '@/src/lib/queue';
import { encryptPayload } from '@/src/lib/crypto';
import { processQueueOnce, setQueueSendHandler } from '@/src/lib/sync';

const secureStore = SecureStore as typeof SecureStore & { __reset?: () => void };

describe('offline queue encryption', () => {
  beforeEach(async () => {
    secureStore.__reset?.();
    await SecureStore.setItemAsync('handover_offline_queue_key', 'test-key-123');
    await clearOfflineQueue();
    setQueueSendHandler(async () => ({ ok: true }));
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'false';
  });

  it('cifra el payload al encolar un bundle', async () => {
    const payload = { resourceType: 'Bundle', marker: 'SECRET-VALUE-12345' };

    await createOfflineQueueItem({ payload, patientId: 'pat-enc' });

    const [stored] = await listOfflineQueue({ decrypt: false });
    const payloadString = typeof stored?.payload === 'string' ? stored.payload : '';
    expect(payloadString).not.toContain('SECRET-VALUE-12345');
    const parsed = payloadString ? JSON.parse(payloadString) : null;
    expect(parsed?.algo).toBe('AES-256-GCM');
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

    expect((sentPayload as { bundle?: unknown }).bundle).toEqual(legacyPayload);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
  });

  it('descifra bundles cifrados con prefijo v1: al procesar la cola', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ resource: { id: '123' } }] };
    const encryptedBundle = await encryptPayload(JSON.stringify(bundle));
    await createOfflineQueueItem({
      payload: { bundle: encryptedBundle },
      patientId: 'pat-v1',
    });

    let sentPayload: unknown;
    setQueueSendHandler(async (item) => {
      sentPayload = item.payload;
      return { ok: true } as const;
    });

    await processQueueOnce();

    expect((sentPayload as { bundle?: unknown }).bundle).toEqual(bundle);
  });

  it('descifra bundles cifrados legacy enc:v1: al procesar la cola', async () => {
    const legacyKey = 'legacy-key-123';
    await SecureStore.setItemAsync('handover_offline_queue_key', legacyKey);
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ resource: { id: 'legacy' } }] };
    const cipher = CryptoJS.AES.encrypt(JSON.stringify(bundle), legacyKey).toString();
    const encryptedBundle = `enc:v1:${cipher}`;

    await createOfflineQueueItem({
      payload: { bundle: encryptedBundle },
      patientId: 'pat-legacy-enc',
    });

    let sentPayload: unknown;
    setQueueSendHandler(async (item) => {
      sentPayload = item.payload;
      return { ok: true } as const;
    });

    await processQueueOnce();

    expect((sentPayload as { bundle?: unknown }).bundle).toEqual(bundle);
  });

  it('acepta bundles sin cifrar en string JSON', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: [{ resource: { id: 'plain' } }] };
    await createOfflineQueueItem({
      payload: { bundle: JSON.stringify(bundle) },
      patientId: 'pat-plain',
    });

    let sentPayload: unknown;
    setQueueSendHandler(async (item) => {
      sentPayload = item.payload;
      return { ok: true } as const;
    });

    await processQueueOnce();

    expect((sentPayload as { bundle?: unknown }).bundle).toEqual(bundle);
  });
});

