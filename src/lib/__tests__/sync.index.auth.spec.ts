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
    vi.clearAllMocks();
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

    expect(result).toEqual({ processed: 0, remaining: 1 });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(runQueueFlushMock).not.toHaveBeenCalled();
    expect(postBundleMock).not.toHaveBeenCalled();
  });

  it('uses the session token provided by auth and not EXPO_PUBLIC_AUTH_TOKEN', async () => {
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
    });

    const { flushQueue } = await loadSyncIndex();
    const result = await flushQueue({
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'session-token',
    });

    expect(result).toEqual({ processed: 1, remaining: 0 });
    expect(runQueueFlushMock).toHaveBeenCalledTimes(1);
    expect(postBundleMock).toHaveBeenCalledWith(bundle, {
      token: 'session-token',
      headers: { 'Idempotency-Key': 'idem-1' },
    });
  });

  it('does not record success evidence when a queue item has no bundle payload', async () => {
    readQueueMock.mockResolvedValue([]);
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

    expect(result).toEqual({ processed: 1, remaining: 0 });
    expect(consumeRecentlySyncedQueueItem('queued-empty')).toBe(false);
    expect(postBundleMock).not.toHaveBeenCalled();
  });
});
