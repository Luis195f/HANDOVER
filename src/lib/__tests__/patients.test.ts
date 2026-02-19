import { beforeEach, describe, expect, it, vi } from 'vitest';

const payload = {
  firstName: 'Ana',
  lastName: 'García',
  nhc: 'NHC-1001',
  unit: 'icu-a',
  service: 'UCI',
  room: 'A-12',
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('createPatient', () => {
  it('routes patient creation through apiPost with backend payload mapping', async () => {
    const apiPostMock = vi.fn(async () => ({ id: 'pat-999' }));

    vi.doMock('@/src/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/src/lib/api')>('@/src/lib/api');
      return {
        ...actual,
        apiPost: apiPostMock,
      };
    });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { createPatient } = await import('@/src/lib/patients');
    const result = await createPatient(payload);

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/api/patients', {
      body: JSON.stringify({
        first_name: payload.firstName,
        last_name: payload.lastName,
        identifier: payload.nhc,
        unit: payload.unit,
        service: payload.service,
        room: payload.room,
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'pat-999' });
  });

  it('uses shared client interception in demo mode without hitting real fetch', async () => {
    vi.doUnmock('@/src/lib/api');

    vi.doMock('@/src/security/tokenSupplier', () => ({
      getToken: vi.fn(async () => null),
    }));

    const demoResponseBody = { id: 'pat-demo-1' };
    const maybeUseDemoResponse = vi.fn(async () =>
      new Response(JSON.stringify(demoResponseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('@/src/demo/net-interceptor', () => ({
      maybeUseDemoResponse,
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { createPatient } = await import('@/src/lib/patients');
    const result = await createPatient(payload);

    expect(maybeUseDemoResponse).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual(demoResponseBody);
  });

  it('preserves network error details for non-ApiClientError failures', async () => {
    const apiPostMock = vi.fn(async () => {
      throw new Error('Network request failed');
    });

    vi.doMock('@/src/lib/api', async () => {
      const actual = await vi.importActual<typeof import('@/src/lib/api')>('@/src/lib/api');
      return {
        ...actual,
        apiPost: apiPostMock,
      };
    });

    const { createPatient, CreatePatientError } = await import('@/src/lib/patients');

    await expect(createPatient(payload)).rejects.toMatchObject({
      status: 0,
      details: expect.stringContaining('Network request failed'),
    });

    await expect(createPatient(payload)).rejects.toBeInstanceOf(CreatePatientError);
  });
});
