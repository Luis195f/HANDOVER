import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHandoverBundle } from '@/src/lib/fhir-map';
vi.mock('expo-sqlite', () => ({
  openDatabaseSync: vi.fn(() => null),
  openDatabase: vi.fn(() => null),
}));

const secureStore = SecureStore as typeof SecureStore & { __reset?: () => void };
let sync: typeof import('@/src/lib/sync');
let queue: typeof import('@/src/lib/queue');

describe('offline queue end-to-end', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    process.env.FHIR_BASE_URL = 'http://test.fhir';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'http://test.fhir';
    queue = await import('@/src/lib/queue');
    sync = await import('@/src/lib/sync');
    secureStore.__reset?.();
    await queue.clearOfflineQueue();
    sync.setQueueSendHandler(async () => ({ ok: true }));
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';
  });

  it('almacena el payload cifrado con sobre AES-GCM', async () => {
    await queue.createOfflineQueueItem({ payload: { foo: 'secret' }, patientId: 'pat-1' });

    const [stored] = await queue.listOfflineQueue({ decrypt: false });
    const payload = typeof stored?.payload === 'string' ? stored.payload : '';
    expect(payload).not.toContain('secret');
    const parsed = payload ? JSON.parse(payload) : null;
    expect(parsed?.algo).toBe('AES-256-GCM');
  });

  it('descifra al procesar la cola y elimina tras éxito', async () => {
    const payload = { resourceType: 'Bundle', marker: 'VALUE-123' };
    let sent: unknown;

    await queue.createOfflineQueueItem({ payload, patientId: 'pat-2' });

    sync.setQueueSendHandler(async (item) => {
      sent = item.payload;
      return { ok: true } as const;
    });

    await sync.processQueueOnce();

    expect((sent as { bundle?: unknown; patientId?: string }).bundle).toEqual(payload);
    expect((sent as { patientId?: string }).patientId).toBe('pat-2');
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });

  it('encola bundles con DocumentReference adjunto y data base64', async () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-attach',
        attachments: [
          {
            uri: 'file:///foto.png',
            contentType: 'image/png',
            name: 'foto.png',
            data: 'SGVsbG8=',
          },
        ],
      },
      { now: '2025-10-21T19:22:00Z' },
    );

    await queue.createOfflineQueueItem({ payload: bundle, patientId: 'pat-attach' });

    const [stored] = await queue.listOfflineQueue();
    const payload = stored?.payload as { bundle?: any } | undefined;
    const docRefs = (payload?.bundle?.entry ?? [])
      .map((entry: any) => entry.resource)
      .filter((resource: any) => resource?.resourceType === 'DocumentReference');
    expect(docRefs[0]?.content?.[0]?.attachment?.data).toBe('SGVsbG8=');
  });

  it('mantiene el item en pendiente tras error 500 y lo limpia al reintentar', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const payload = { resourceType: 'Bundle', marker: 'ERROR-500' };
    await queue.createOfflineQueueItem({ payload, patientId: 'pat-500' });

    sync.setQueueSendHandler(async () => ({ ok: false as const, status: 500, message: 'boom' }));
    await sync.processQueueOnce();

    const [pending] = await queue.listOfflineQueue();
    expect(pending?.syncStatus).toBe('pending');
    expect(pending?.errorMessage).toBe('boom');

    const waitMs = sync.getNextDelayMs(pending?.attempts ?? 0);
    vi.setSystemTime(baseTime + waitMs + 20);

    sync.setQueueSendHandler(async () => ({ ok: true as const }));
    await sync.processQueueOnce();
    expect(await queue.listOfflineQueue()).toHaveLength(0);

    vi.useRealTimers();
  });

  it('respeta el backoff exponencial entre intentos', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    const created = await queue.createOfflineQueueItem({
      payload: { foo: 'bar' },
      patientId: 'pat-backoff',
      createdAt: new Date(baseTime).toISOString(),
      attempts: 2,
      syncStatus: 'pending',
      lastAttemptAt: new Date(baseTime).toISOString(),
    });

    let calls = 0;
    sync.setQueueSendHandler(async () => {
      calls += 1;
      return { ok: true } as const;
    });

    await sync.processQueueOnce();
    expect(calls).toBe(0);

    const waitMs = sync.getNextDelayMs(created.attempts);
    vi.setSystemTime(baseTime + waitMs + 10);

    await sync.processQueueOnce();
    expect(calls).toBe(1);

    vi.useRealTimers();
  });

  it('marca fallos permanentes y no reintenta', async () => {
    await queue.createOfflineQueueItem({ payload: { foo: 'fail' }, patientId: 'pat-fail' });

    sync.setQueueSendHandler(async () => ({ ok: false as const, recoverable: false, message: 'invalid data' }));
    await sync.processQueueOnce();

    const [failed] = await queue.listOfflineQueue();
    expect(failed?.syncStatus).toBe('error');
    expect(failed?.errorMessage).toBe('invalid data');

    let retried = false;
    sync.setQueueSendHandler(async () => {
      retried = true;
      return { ok: true } as const;
    });

    await sync.processQueueOnce();
    expect(retried).toBe(false);
  });
});
