import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createPatient } from '@/src/lib/patients';

vi.mock('@/src/security/tokenSupplier', () => ({
  getToken: vi.fn(async () => null),
}));

describe('createPatient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts patient payload to /api/patients', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pat-999' }),
    }));

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const payload = {
      firstName: 'Ana',
      lastName: 'García',
      nhc: 'NHC-1001',
      unit: 'icu-a',
      service: 'UCI',
      room: 'A-12',
    };

    const result = await createPatient(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/patients');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(payload));
    expect(result).toEqual({ id: 'pat-999' });
  });
});
