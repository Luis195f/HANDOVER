import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import syntheticBundle from '../fixtures/fhir/minimal-transaction-bundle.json';

vi.mock('expo-sqlite', () => ({ openDatabaseSync: undefined, openDatabase: undefined }));

describe('canonical queue sender and real FHIR client over a synthetic HTTP boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', true);
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://handover.test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  });

  it('retains an unconfirmed response, then sends the same transaction identity until confirmation', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      const body = requests.length === 1
        ? { ok: true }
        : { resourceType: 'Bundle', type: 'transaction-response', entry: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/fhir+json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const queue = await import('@/src/lib/queue');
    const sync = await import('@/src/lib/sync');
    const queued = await queue.enqueueBundle(syntheticBundle, { patientId: 'synthetic-patient' });
    const options = { fhirBaseUrl: 'https://unused.invalid', getToken: async () => 'synthetic-token' };

    const unconfirmed = await sync.flushSyncQueue(options);
    expect(unconfirmed.processed).toBe(0);
    expect((await queue.listOfflineQueue())[0]?.id).toBe(queued.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://handover.test/api/fhir/transaction');

    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000);
    const confirmed = await sync.flushSyncQueue(options);
    clock.mockRestore();
    expect(confirmed.processed).toBe(1);
    expect(await queue.listOfflineQueue()).toEqual([]);
    expect(requests).toHaveLength(2);
    const headers = requests.map(({ init }) => new Headers(init.headers));
    expect(headers[0]?.get('Idempotency-Key')).toBe(queued.id);
    expect(headers[1]?.get('Idempotency-Key')).toBe(queued.id);
    expect(requests[0]?.init.body).toBe(requests[1]?.init.body);
  });
});
