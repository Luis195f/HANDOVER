jest.mock('@/src/lib/auth', () => ({
  ensureFreshToken: jest.fn(async () => 'auto-token'),
  logout: jest.fn(async () => undefined),
}));

import { ensureFreshToken, logout } from '@/src/lib/auth';

describe('fhir-client', () => {
  beforeEach(() => {
    (globalThis.fetch as jest.Mock).mockReset();
  });

  test('postBundle uses ensureFreshToken when token omitted', async () => {
    const { postBundle } = await import('@/src/lib/fhir-client');
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue('Observation/1') },
      json: jest.fn().mockResolvedValue({ resourceType: 'Bundle' }),
    });
    await postBundle({ resourceType: 'Bundle' }, {});
    expect(ensureFreshToken).toHaveBeenCalled();
  });

  test('postBundle returns error issues on failure', async () => {
    const { postBundle } = await import('@/src/lib/fhir-client');
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: jest.fn().mockReturnValue(null) },
      json: jest.fn().mockResolvedValue({ issue: [{ code: 'invalid' }] }),
    });
    const result = await postBundle({ resourceType: 'Bundle' }, { token: 'manual' });
    expect(result.ok).toBe(false);
    expect(result.issue?.[0].code).toBe('invalid');
  });

  test('fetchFHIR injects authorization header', async () => {
    const { fetchFHIR } = await import('@/src/lib/fhir-client');
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn(),
      headers: { get: jest.fn().mockReturnValue(null) },
    });
    await fetchFHIR('/Patient');
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('https://fhir.test');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer auto-token');
  });

  test('fetchFHIR triggers logout on unauthorized', async () => {
    const { fetchFHIR } = await import('@/src/lib/fhir-client');
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn(),
      headers: { get: jest.fn().mockReturnValue(null) },
    });
    await expect(fetchFHIR('/Encounter')).rejects.toThrow(/unauthorized/);
    expect(logout).toHaveBeenCalled();
  });

  test('fetchFHIR allows custom token and headers', async () => {
    const { fetchFHIR } = await import('@/src/lib/fhir-client');
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn(),
      headers: { get: jest.fn().mockReturnValue(null) },
    });
    await fetchFHIR('/Observation', {
      token: 'custom-token',
      headers: { 'X-Test': 'value' },
    });
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer custom-token');
    expect((init.headers as Headers).get('X-Test')).toBe('value');
  });
});
