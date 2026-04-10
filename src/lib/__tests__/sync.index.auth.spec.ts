import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushSyncQueueMock = vi.fn();
const startSyncDaemonMock = vi.fn(() => vi.fn());
const getCanonicalQueueSizeMock = vi.fn();
const consumeRecentlySyncedQueueItemMock = vi.fn();

vi.mock('@/src/lib/sync', () => ({
  flushSyncQueue: (...args: unknown[]) => flushSyncQueueMock(...args),
  startSyncDaemon: (...args: unknown[]) => startSyncDaemonMock(...args),
  getCanonicalQueueSize: (...args: unknown[]) => getCanonicalQueueSizeMock(...args),
  consumeRecentlySyncedQueueItem: (...args: unknown[]) => consumeRecentlySyncedQueueItemMock(...args),
}));

vi.mock('@/src/lib/queue', () => ({
  enqueueBundle: vi.fn(),
}));

vi.mock('@/src/lib/netinfo', () => ({
  default: {
    fetch: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
}));

vi.mock('@/src/lib/fhir-validation/zod', () => ({
  validateBundle: vi.fn(() => ({ isValid: true, errors: [] })),
  validateResourceWithZod: vi.fn(() => ({ isValid: true, errors: [] })),
}));

async function loadSyncIndex() {
  return import('@/src/lib/sync/index');
}

describe('legacy sync compatibility shim', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('delegates manual flush to the canonical sync runtime', async () => {
    flushSyncQueueMock.mockResolvedValue({ processed: 0, remaining: 1, outcome: 'auth-required', status: 401 });

    const { flushQueue } = await loadSyncIndex();
    const opts = {
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => null,
    };

    await expect(flushQueue(opts)).resolves.toEqual({
      processed: 0,
      remaining: 1,
      outcome: 'auth-required',
      status: 401,
    });
    expect(flushSyncQueueMock).toHaveBeenCalledWith(opts);
  });

  it('delegates daemon startup to the canonical sync runtime', async () => {
    const stop = vi.fn();
    startSyncDaemonMock.mockReturnValue(stop);

    const { startSyncDaemon } = await loadSyncIndex();
    const opts = {
      fhirBaseUrl: 'https://fhir.test/api',
      getToken: async () => 'token',
    };

    expect(startSyncDaemon(opts)).toBe(stop);
    expect(startSyncDaemonMock).toHaveBeenCalledWith(opts);
  });

  it('reads queue size and recent sync evidence from the canonical runtime', async () => {
    getCanonicalQueueSizeMock.mockResolvedValue(3);
    consumeRecentlySyncedQueueItemMock.mockReturnValue(true);

    const { consumeRecentlySyncedQueueItem, getQueueSize } = await loadSyncIndex();

    await expect(getQueueSize()).resolves.toBe(3);
    expect(consumeRecentlySyncedQueueItem('queued-1')).toBe(true);
    expect(getCanonicalQueueSizeMock).toHaveBeenCalledTimes(1);
    expect(consumeRecentlySyncedQueueItemMock).toHaveBeenCalledWith('queued-1');
  });
});
