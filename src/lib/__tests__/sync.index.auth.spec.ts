import { beforeEach, describe, expect, it, vi } from 'vitest';

const configureFHIRClientMock = vi.fn();
const postBundleMock = vi.fn();
const runQueueFlushMock = vi.fn();
const readQueueMock = vi.fn();
const addEventListenerMock = vi.fn(() => vi.fn());
const fetchNetworkMock = vi.fn(async () => ({ isConnected: true, isInternetReachable: true }));

vi.mock('@/src/lib/fhir-client', () => ({
  configureFHIRClient: (...args: unknown[]) => configureFHIRClientMock(...args),
  postBundle: (...args: unknown[]) => postBundleMock(...args),
}));

vi.mock('@/src/lib/fhir-validation/zod', () => ({
  validateBundle: vi.fn(() => ({ isValid: true, errors: [] })),
  validateResourceWithZod: vi.fn(() => ({ isValid: true, errors: [] })),
}));

vi.mock('@/src/lib/offlineQueue', () => ({
  enqueueTx: vi.fn(),
  flushQueue: (...args: unknown[]) => runQueueFlushMock(...args),
  readQueue: (...args: unknown[]) => readQueueMock(...args),
}));

vi.mock('@/src/lib/netinfo', () => ({
  default: {
    addEventListener: (...args: unknown[]) => addEventListenerMock(...args),
    fetch: (...args: unknown[]) => fetchNetworkMock(...args),
  },
}));

const bundle = {
  resourceType: 'Bundle' as const,
  type: 'transaction' as const,
  entry: [
    {
      fullUrl: 'urn:uuid:obs-1',
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [
          {
            coding: [
              { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' },
            ],
          },
        ],
        code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
        subject: { reference: 'Patient/p-1' },
        effectiveDateTime: '2024-01-01T00:00:00.000Z',
      },
      request: { method: 'POST', url: 'Observation' },
    },
  ],
};

async function loadSyncIndex() {
  return import('@/src/lib/sync/index');
}

describe('legacy sync runtime auth seam', () => {
  beforeEach(() => {
    vi.resetModules();
    configureFHIRClientMock.mockReset();
    postBundleMock.mockReset();
    runQueueFlushMock.mockReset();
    readQueueMock.mockReset();
    addEventListenerMock.mockReset();
    fetchNetworkMock.mockReset();
    addEventListenerMock.mockReturnValue(vi.fn());
    fetchNetworkMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    delete process.env.EXPO_PUBLIC_AUTH_TOKEN;
  });

  it('fails safe without a valid session token and does not drain the queue', async () => {
    readQueueMock.mockResolvedValue([{ key: 'queued-1' }]);
    const getToken = vi.fn(async () => null);

    const { flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken,
    });

    expect(result).toEqual({ processed: 0, remaining: 1, outcome: 'auth-required', status: 401 });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(runQueueFlushMock).not.toHaveBeenCalled();
    expect(postBundleMock).not.toHaveBeenCalled();
  });

  it('preserves auth-failed when the token refresher throws and does not drain the queue', async () => {
    readQueueMock.mockResolvedValue([{ key: 'queued-1' }]);
    const getToken = vi.fn(async () => {
      throw new Error('refresh exploded');
    });

    const { flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken,
    });

    expect(result).toEqual({ processed: 0, remaining: 1, outcome: 'auth-failed', status: 401 });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(runQueueFlushMock).not.toHaveBeenCalled();
    expect(postBundleMock).not.toHaveBeenCalled();
  });

  it('uses a fresh session token per replay item and not EXPO_PUBLIC_AUTH_TOKEN', async () => {
    process.env.EXPO_PUBLIC_AUTH_TOKEN = 'public-token';
    readQueueMock.mockResolvedValue([]);
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });
    runQueueFlushMock.mockImplementation(async (sender: (tx: unknown) => Promise<unknown>) => {
      await sender({
        id: 'queued-1',
        key: 'queued-1',
        tries: 0,
        payload: {
          bundle,
          meta: { hash: 'idem-1' },
        },
      });
      await sender({
        id: 'queued-2',
        key: 'queued-2',
        tries: 0,
        payload: {
          bundle,
          meta: { hash: 'idem-2' },
        },
      });
    });
    const getToken = vi
      .fn()
      .mockResolvedValueOnce('session-token-1')
      .mockResolvedValueOnce('session-token-2')
      .mockResolvedValueOnce('session-token-3');

    const { flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken,
    });

    expect(result).toEqual({ processed: 2, remaining: 0, outcome: 'success', status: undefined });
    expect(runQueueFlushMock).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(postBundleMock).toHaveBeenNthCalledWith(1, bundle, {
      token: 'session-token-2',
      headers: { 'Idempotency-Key': 'idem-1' },
    });
    expect(postBundleMock).toHaveBeenNthCalledWith(2, bundle, {
      token: 'session-token-3',
      headers: { 'Idempotency-Key': 'idem-2' },
    });
  });

  it('does not record success evidence when a queue item has no bundle payload', async () => {
    readQueueMock.mockResolvedValue([{ key: 'queued-empty' }]);
    runQueueFlushMock.mockImplementation(async (sender: (tx: unknown) => Promise<unknown>) => {
      await sender({
        id: 'queued-empty',
        key: 'queued-empty',
        tries: 0,
        payload: {},
      });
    });

    const { consumeRecentlySyncedQueueItem, flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'session-token',
    });

    expect(result).toEqual({ processed: 0, remaining: 1, outcome: 'client-error', status: 422 });
    expect(consumeRecentlySyncedQueueItem('queued-empty')).toBe(false);
    expect(postBundleMock).not.toHaveBeenCalled();
  });

  it('distinguishes auth outcomes from server failures', async () => {
    readQueueMock.mockResolvedValue([{ key: 'queued-1' }]);
    runQueueFlushMock.mockImplementation(async (sender: (tx: unknown) => Promise<unknown>) => {
      await sender({
        id: 'queued-1',
        key: 'queued-1',
        tries: 0,
        payload: {
          bundle,
          meta: { hash: 'idem-1' },
        },
      });
    });

    postBundleMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const { flushQueue } = await loadSyncIndex();
    const authResult = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'session-token',
      backoff: { retries: 0, minMs: 0, maxMs: 0 },
    });

    postBundleMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const serverResult = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'session-token',
      backoff: { retries: 0, minMs: 0, maxMs: 0 },
    });

    expect(authResult).toEqual({ processed: 0, remaining: 1, outcome: 'auth-required', status: 401 });
    expect(serverResult).toEqual({ processed: 0, remaining: 1, outcome: 'server-error', status: 503 });
  });

  it('treats 409 idempotent conflicts as remote success evidence without retry loops', async () => {
    readQueueMock.mockResolvedValueOnce([]);
    runQueueFlushMock.mockImplementation(async (sender: (tx: unknown) => Promise<unknown>) => {
      await sender({
        id: 'queued-409',
        key: 'queued-409',
        tries: 0,
        payload: {
          bundle,
          meta: { hash: 'idem-409' },
        },
      });
    });
    postBundleMock.mockResolvedValueOnce({ ok: false, status: 409, body: {} });

    const { flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'session-token',
      backoff: { retries: 3, minMs: 0, maxMs: 0 },
    });

    expect(result).toEqual({ processed: 1, remaining: 0, outcome: 'success', status: undefined });
    expect(postBundleMock).toHaveBeenCalledTimes(1);
  });
});
