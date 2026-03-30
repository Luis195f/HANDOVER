import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureFreshAccessTokenMock = vi.fn();
const startSyncDaemonMock = vi.fn();
const flushQueueMock = vi.fn();

vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: (...args: unknown[]) => ensureFreshAccessTokenMock(...args),
}));

vi.mock('@/src/lib/sync/index', () => ({
  startSyncDaemon: (...args: unknown[]) => startSyncDaemonMock(...args),
  flushQueue: (...args: unknown[]) => flushQueueMock(...args),
}));

vi.mock('@/src/config/env', () => ({
  ENV: { FHIR_BASE_URL: 'https://env.fhir.test' },
  FHIR_BASE_URL: 'https://fallback.fhir.test',
}));

async function loadQueueBootstrap() {
  return import('@/src/lib/queueBootstrap');
}

describe('queueBootstrap auth seam', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.EXPO_PUBLIC_AUTH_TOKEN;
  });

  it('wires the legacy daemon to a fresh session token instead of a bootstrap token override', async () => {
    ensureFreshAccessTokenMock.mockResolvedValue('session-token');
    const stop = vi.fn();
    startSyncDaemonMock.mockReturnValue(stop);

    const { installQueueSync } = await loadQueueBootstrap();
    const returnedStop = installQueueSync({ token: 'legacy-static-token' });

    expect(returnedStop).toBe(stop);
    expect(startSyncDaemonMock).toHaveBeenCalledTimes(1);

    const syncOpts = startSyncDaemonMock.mock.calls[0]?.[0];
    await expect(syncOpts.getToken()).resolves.toBe('session-token');
    expect(ensureFreshAccessTokenMock).toHaveBeenCalledWith('fhir');
  });

  it('flushNow ignores EXPO_PUBLIC_AUTH_TOKEN as an auth bypass', async () => {
    process.env.EXPO_PUBLIC_AUTH_TOKEN = 'public-token';
    ensureFreshAccessTokenMock.mockResolvedValue(null);
    flushQueueMock.mockResolvedValue({ processed: 0, remaining: 1 });

    const { flushNow } = await loadQueueBootstrap();
    await flushNow();

    expect(flushQueueMock).toHaveBeenCalledTimes(1);
    const syncOpts = flushQueueMock.mock.calls[0]?.[0];
    await expect(syncOpts.getToken()).resolves.toBeNull();
    expect(ensureFreshAccessTokenMock).toHaveBeenCalledWith('fhir');
  });
});
