jest.mock('@/src/lib/net', () => ({
  fetchWithRetry: jest.fn(),
}));

import { fetchWithRetry } from '@/src/lib/net';
import { configureFHIRClient, fetchFHIR, postBundle } from '@/src/lib/fhir-client';

describe('fhir-client', () => {
  const ensureFreshToken = jest.fn(async () => 'auto-token');
  const logout = jest.fn(async () => {});

  beforeEach(() => {
    ensureFreshToken.mockReset();
    ensureFreshToken.mockImplementation(async () => 'auto-token');
    logout.mockReset();
    (fetchWithRetry as jest.Mock).mockReset();
    configureFHIRClient({
      ensureFreshToken,
      logout,
      getBaseUrl: () => 'https://fhir.test',
    });
  });

  test('postBundle uses ensureFreshToken when token omitted', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ resourceType: 'Bundle' })),
      headers: { get: jest.fn() },
    });
    await postBundle({ resourceType: 'Bundle' }, {});
    expect(ensureFreshToken).toHaveBeenCalled();
    const [, init] = (fetchWithRetry as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer auto-token');
  });

  test('postBundle returns error issues on failure', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(JSON.stringify({ issue: [{ code: 'invalid' }] })),
      headers: { get: jest.fn() },
    });
    const result = await postBundle({ resourceType: 'Bundle' }, { token: 'manual' });
    expect(result.ok).toBe(false);
    expect(result.issues?.[0].code).toBe('invalid');
  });

  test('fetchFHIR injects authorization header', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ resourceType: 'Patient' })),
      headers: { get: jest.fn() },
    });
    const result = await fetchFHIR({ path: '/Patient' });
    const [url, init] = (fetchWithRetry as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('https://fhir.test/Patient');
    expect(init.headers.Authorization).toBe('Bearer auto-token');
    expect(result.ok).toBe(true);
  });

  test('fetchFHIR triggers logout on unauthorized', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue(''),
      headers: { get: jest.fn() },
    });
    await expect(fetchFHIR({ path: '/Encounter' })).rejects.toThrow('unauthorized');
    expect(logout).toHaveBeenCalled();
  });

  test('fetchFHIR throws when no access token is available', async () => {
    ensureFreshToken.mockResolvedValueOnce(null);
    await expect(fetchFHIR({ path: '/Condition' })).rejects.toThrow('NOT_AUTHENTICATED');
    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  test('fetchFHIR allows custom token and headers', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
      headers: { get: jest.fn() },
    });
    await fetchFHIR({
      path: '/Observation',
      token: 'custom-token',
      headers: { 'X-Test': 'value' },
    });
    const [, init] = (fetchWithRetry as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer custom-token');
    expect(init.headers['X-Test']).toBe('value');
  });
});
