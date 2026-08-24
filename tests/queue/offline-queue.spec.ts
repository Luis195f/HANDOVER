import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    vi.stubGlobal('__DEV__', true);
    process.env.FHIR_BASE_URL = 'http://test.fhir';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'http://test.fhir';
    queue = await import('@/src/lib/queue');
    sync = await import('@/src/lib/sync');
    secureStore.__reset?.();
    await queue.clearOfflineQueue();
    sync.setQueueSendHandler(async () => ({ ok: true }));
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'false';
  });

  afterEach(() => {
    vi.doUnmock('@/src/lib/crypto');
  });

  it('almacena el payload cifrado con sobre AES-GCM', async () => {
    await queue.createOfflineQueueItem({ payload: { foo: 'secret' }, patientId: 'pat-1' });

    const [stored] = await queue.listOfflineQueue({ decrypt: false });
    const payload = typeof stored?.payload === 'string' ? stored.payload : '';
    expect(payload).not.toContain('secret');
    const parsed = payload ? JSON.parse(payload) : null;
    expect(parsed?.algo).toBe('AES-256-GCM');
  });

  it('uses AES-GCM exclusively for successful new clinical queue writes', async () => {
    vi.resetModules();
    secureStore.__reset?.();
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'false';

    const cbcEncryptSpy = vi.fn(async () => 'v1:cbc-must-not-run');
    vi.doMock('@/src/lib/crypto', async () => {
      const actual = await vi.importActual<typeof import('@/src/lib/crypto')>('@/src/lib/crypto');
      return { ...actual, encryptPayload: cbcEncryptSpy };
    });

    const isolatedQueue = await import('@/src/lib/queue');
    await isolatedQueue.clearOfflineQueue();
    await isolatedQueue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', marker: 'GCM-ONLY-PHI' } },
      patientId: 'pat-gcm-only',
    });

    const [stored] = await isolatedQueue.listOfflineQueue({ decrypt: false });
    const rawPayload = String(stored?.payload ?? '');
    expect(JSON.parse(rawPayload)).toMatchObject({ v: 1, algo: 'AES-256-GCM' });
    expect(rawPayload).not.toContain('GCM-ONLY-PHI');
    expect(cbcEncryptSpy).not.toHaveBeenCalled();
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

  it('keeps network errors retryable when the queue handler throws a plain Error', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    await queue.createOfflineQueueItem({ payload: { foo: 'network' }, patientId: 'pat-network' });

    const sender = vi.fn(async () => {
      throw new Error('network down');
    });
    sync.setQueueSendHandler(sender);

    await sync.processQueueOnce();

    const [pending] = await queue.listOfflineQueue();
    expect(pending?.syncStatus).toBe('pending');
    expect(pending?.errorMessage).toBe('network down');

    const waitMs = sync.getNextDelayMs(pending?.attempts ?? 0);
    vi.setSystemTime(baseTime + waitMs + 20);

    sync.setQueueSendHandler(async () => ({ ok: true as const }));
    await sync.processQueueOnce();

    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(sender).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('marca error permanente para 422 y notifica sin reintentos', async () => {
    await queue.createOfflineQueueItem({ payload: { foo: 'invalid' }, patientId: 'pat-422' });

    sync.setQueueSendHandler(async () => ({ ok: false as const, status: 422, message: 'FHIR invalid' }));
    await sync.processQueueOnce();

    const items = await queue.listOfflineQueue();
    const pending = items.filter((item) => item.syncStatus === 'pending' || item.syncStatus === 'inFlight');
    expect(pending).toHaveLength(0);
    expect(items[0]?.syncStatus).toBe('error');
    expect(items[0]?.errorMessage).toBe('Sincronización detenida: validación remota fallida (422).');

    const scheduleSpy = vi.mocked(Notifications.scheduleNotificationAsync);
    expect(scheduleSpy).toHaveBeenCalled();

    let retried = false;
    sync.setQueueSendHandler(async () => {
      retried = true;
      return { ok: true } as const;
    });

    await sync.processQueueOnce();
    expect(retried).toBe(false);
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

  it('marca como error tras el máximo de reintentos y no vuelve a enviar', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
    vi.setSystemTime(baseTime);

    await queue.createOfflineQueueItem({
      payload: { foo: 'fail-max' },
      patientId: 'pat-max',
      attempts: 2,
      syncStatus: 'pending',
      lastAttemptAt: new Date(baseTime - sync.getNextDelayMs(2)).toISOString(),
    });

    const sender = vi.fn(async () => ({ ok: false as const, status: 500, message: 'boom' }));
    sync.setQueueSendHandler(sender);

    await sync.processQueueOnce();

    const [failed] = await queue.listOfflineQueue();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(failed?.syncStatus).toBe('error');
    expect(failed?.attempts).toBe(3);

    sender.mockClear();
    await sync.processQueueOnce();
    expect(sender).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('treats duplicate 412 responses as delivered and removes the item', async () => {
    await queue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] }, txId: 'tx-dup' },
      patientId: 'pat-dup',
    });

    const sender = vi.fn(async () => ({ ok: false as const, status: 412, message: 'duplicate' }));
    sync.setQueueSendHandler(sender);

    await sync.processQueueOnce();

    expect(sender).toHaveBeenCalledTimes(1);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
  });

  it('dedupes the same logical payload under encryption even when ciphertext changes', async () => {
    const keyBytes = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
    const ivs = [
      Uint8Array.from({ length: 12 }, () => 17),
      Uint8Array.from({ length: 12 }, () => 33),
    ];
    let ivIndex = 0;

    vi.spyOn(Crypto, 'getRandomBytesAsync').mockImplementation(async (length: number) => {
      if (length === 32) return keyBytes;
      if (length === 12) {
        const nextIv = ivs[Math.min(ivIndex, ivs.length - 1)];
        ivIndex += 1;
        return nextIv;
      }
      return Uint8Array.from({ length }, (_value, index) => (index + 1) % 255);
    });

    const payload = { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] }, txId: 'tx-same' };

    const first = await queue.createOfflineQueueItem({ payload, patientId: 'pat-same' });
    const [storedAfterFirst] = await queue.listOfflineQueue({ decrypt: false });
    const firstCiphertext = String(storedAfterFirst?.payload ?? '');

    const second = await queue.createOfflineQueueItem({ payload, patientId: 'pat-same' });
    const [storedAfterSecond] = await queue.listOfflineQueue({ decrypt: false });
    const secondCiphertext = String(storedAfterSecond?.payload ?? '');

    expect(firstCiphertext).not.toBe(secondCiphertext);
    expect(first.id).toBe(second.id);
    expect(storedAfterSecond?.id).toBe(first.id);
    expect(await queue.listOfflineQueue({ decrypt: false })).toHaveLength(1);
  });

  it('refuses plaintext offline persistence in production even if the disable-encryption flag is set', async () => {
    vi.resetModules();
    secureStore.__reset?.();
    process.env.NODE_ENV = 'production';
    process.env.FHIR_BASE_URL = 'http://test.fhir';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'http://test.fhir';
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';
    vi.stubGlobal('__DEV__', false);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const isolatedQueue = await import('@/src/lib/queue');
    await isolatedQueue.clearOfflineQueue();

    const item = await isolatedQueue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', marker: 'PHI-SECRET' } },
      patientId: 'pat-prod',
    });
    const [stored] = await isolatedQueue.listOfflineQueue({ decrypt: false });
    const rawPayload = String(stored?.payload ?? '');

    expect(item.syncStatus).toBe('error');
    expect(item.errorMessage).toBe('No se pudo proteger el payload offline; no se persistio contenido clinico.');
    expect(rawPayload).not.toContain('PHI-SECRET');
    expect(rawPayload).not.toContain('pat-prod');
    expect(rawPayload).toContain('__encryptionFailed');
    expect(warnSpy.mock.calls.some(([message]) => typeof message === 'string' && message.includes('HNDR_QUEUE_003'))).toBe(true);
  });

  it('fails closed with one hash-only warning and never invokes CBC when GCM fails', async () => {
    vi.resetModules();
    secureStore.__reset?.();
    process.env.FHIR_BASE_URL = 'http://test.fhir';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'http://test.fhir';
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'false';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cbcEncryptSpy = vi.fn(async () => 'v1:cbc-must-not-run');
    vi.doMock('@/src/lib/crypto', async () => {
      const actual = await vi.importActual<typeof import('@/src/lib/crypto')>('@/src/lib/crypto');
      return {
        ...actual,
        isEncryptionDisabled: () => false,
        encryptOfflinePayload: vi.fn(async () => {
          throw new Error('offline encryption failed');
        }),
        encryptPayload: cbcEncryptSpy,
      };
    });

    const isolatedQueue = await import('@/src/lib/queue');
    await isolatedQueue.clearOfflineQueue();
    const first = await isolatedQueue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', marker: 'PHI-FIRST' } },
      patientId: 'pat-sensitive-first',
    });
    const second = await isolatedQueue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', marker: 'PHI-SECOND' } },
      patientId: 'pat-sensitive-second',
    });

    const protectionWarnings = warnSpy.mock.calls.filter(([message]) =>
      typeof message === 'string' && message.includes('HNDR_QUEUE_002')
    );
    const stored = await isolatedQueue.listOfflineQueue({ decrypt: false });
    const persisted = stored.map((item) => String(item.payload ?? '')).join('\n');
    const sentinels = stored.map((item) => JSON.parse(String(item.payload ?? '')) as Record<string, unknown>);

    expect(cbcEncryptSpy).not.toHaveBeenCalled();
    expect(first.syncStatus).toBe('error');
    expect(second.syncStatus).toBe('error');
    expect(sentinels).toHaveLength(2);
    expect(sentinels.every((sentinel) => sentinel.__encryptionFailed === true && sentinel.v === 1)).toBe(true);
    expect(sentinels.every((sentinel) => typeof sentinel.payloadHash === 'string' && /^[a-f0-9]{64}$/.test(sentinel.payloadHash))).toBe(true);
    expect(persisted).not.toContain('PHI-FIRST');
    expect(persisted).not.toContain('PHI-SECOND');
    expect(persisted).not.toContain('pat-sensitive');
    expect(protectionWarnings).toHaveLength(1);
    expect(JSON.stringify(protectionWarnings)).not.toContain('pat-sensitive');
    expect(JSON.stringify(protectionWarnings)).not.toContain('patientId');
  });

  it('marks 400 responses as final errors without retrying again', async () => {
    await queue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-400',
    });

    const sender = vi.fn(async () => ({ ok: false as const, status: 400, message: 'bad request' }));
    sync.setQueueSendHandler(sender);

    await sync.processQueueOnce();
    sender.mockClear();
    await sync.processQueueOnce();

    const [failed] = await queue.listOfflineQueue();
    expect(sender).not.toHaveBeenCalled();
    expect(failed?.syncStatus).toBe('error');
    expect(failed?.errorStatus).toBe(400);
  });

  it('fails closed on 403 by marking the replay as terminal instead of retrying forever', async () => {
    await queue.createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-403',
    });

    const sender = vi.fn(async () => ({ ok: false as const, status: 403, message: 'forbidden' }));
    sync.setQueueSendHandler(sender);

    await sync.processQueueOnce();
    sender.mockClear();
    await sync.processQueueOnce();

    const [failed] = await queue.listOfflineQueue();
    expect(sender).not.toHaveBeenCalled();
    expect(failed?.syncStatus).toBe('error');
    expect(failed?.errorStatus).toBe(403);
    expect(failed?.errorMessage).toBe('Falló la actualización de autenticación. Inicia sesión de nuevo.');
  });

  it('canonical replay preserves auth hooks, refreshes after 401, and succeeds once without duplicating the transaction', async () => {
    const client = await import('@/src/lib/fhir-client');
    const bundle = sync.buildTransactionBundleForQueue({ patientId: 'pat-refresh-runtime' } as any, {
      now: '2025-01-01T00:00:00.000Z',
    });
    const queued = await queue.enqueueBundle(bundle, { patientId: 'pat-refresh-runtime' });

    const refreshSpy = vi.fn(async (reason?: string) => {
      expect(reason).toBe('401');
      return 'fresh-bearer';
    });
    const logoutSpy = vi.fn();
    client.configureFHIRClient({
      ensureFreshToken: refreshSpy,
      logout: logoutSpy,
    });

    const authHeaders: string[] = [];
    const idempotencyKeys: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get('Authorization') ?? '');
      idempotencyKeys.push(headers.get('Idempotency-Key') ?? '');

      if (authHeaders.length === 1) {
        return new Response(JSON.stringify({ detail: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/fhir+json' },
        });
      }

      return new Response(JSON.stringify({ resourceType: 'Bundle', id: 'replay-ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/fhir+json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await sync.flushSyncQueue({
      fhirBaseUrl: 'https://example.test',
      getToken: async () => 'stale-bearer',
      backoff: { retries: 1, minMs: 0, maxMs: 0 },
    });

    expect(result).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaders).toEqual(['Bearer stale-bearer', 'Bearer fresh-bearer']);
    expect(idempotencyKeys).toEqual([queued.id, queued.id]);
    expect(await queue.listOfflineQueue()).toHaveLength(0);
    expect(sync.consumeRecentlySyncedQueueItem(queued.id)).toBe(true);
    expect(sync.consumeRecentlySyncedQueueItem(queued.id)).toBe(false);
  });
});

