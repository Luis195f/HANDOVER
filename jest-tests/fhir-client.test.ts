jest.mock('@/src/lib/net', () => ({
  fetchWithRetry: jest.fn(),
}));

import { fetchWithRetry } from '@/src/lib/net';
import { configureFHIRClient, fetchFHIR, postBundle } from '@/src/lib/fhir-client';

function readHeader(headers: any, key: string): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(key) ?? undefined; // Headers()
  return headers[key] ?? headers[key.toLowerCase()] ?? undefined; // objeto plano
}

describe('fhir-client', () => {
  const ensureFreshToken = jest.fn(async () => 'auto-token');
  const logout = jest.fn(async () => {});

  // Bundle “válido” (transaction) para tests de postBundle
  const bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        request: { method: 'POST', url: 'Observation' },
        resource: {
          resourceType: 'Observation',
          status: 'final',
          code: { text: 'Mock observation' },
        },
      },
    ],
  };

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

    await postBundle(bundle as any, {} as any);

    expect(ensureFreshToken).toHaveBeenCalledTimes(1);

    const [, init] = (fetchWithRetry as jest.Mock).mock.calls[0];
    const auth = readHeader(init?.headers, 'Authorization');
    expect(auth).toBe('Bearer auto-token');
  });

  test('postBundle returns error issues on failure', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue(JSON.stringify({ issue: [{ code: 'invalid' }] })),
      headers: { get: jest.fn() },
    });

    const result = await postBundle(bundle as any, { token: 'manual' } as any);

    expect(result.ok).toBe(false);
    expect(result.issues?.[0]?.code).toBe('invalid');
  });

  test('fetchFHIR injects authorization header', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ resourceType: 'Patient' })),
      headers: { get: jest.fn() },
    });

    const result = await fetchFHIR({ path: '/Patient' } as any);

    const [url, init] = (fetchWithRetry as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('https://fhir.test/Patient');

    const auth = readHeader(init?.headers, 'Authorization');
    expect(auth).toBe('Bearer auto-token');

    expect(result.ok).toBe(true);
  });

  test('fetchFHIR triggers logout on unauthorized', async () => {
    (fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue(''),
      headers: { get: jest.fn() },
    });

    await expect(fetchFHIR({ path: '/Encounter' } as any)).rejects.toThrow('unauthorized');
    expect(logout).toHaveBeenCalledTimes(1);
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
    } as any);

    const [, init] = (fetchWithRetry as jest.Mock).mock.calls[0];

    const auth = readHeader(init?.headers, 'Authorization');
    expect(auth).toBe('Bearer custom-token');

    const xTest = readHeader(init?.headers, 'X-Test') ?? init?.headers?.['X-Test'];
    expect(xTest).toBe('value');
  });
});
