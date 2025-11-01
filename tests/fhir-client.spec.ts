import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bundle = {
  resourceType: 'Bundle' as const,
  type: 'transaction' as const,
  entry: [],
};

async function loadClient() {
  vi.resetModules();
  process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'https://fhir.test/api';
  const mod = await import('@/src/lib/fhir-client');
  return mod;
}

describe('postBundle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when token is missing', async () => {
    const { postBundle } = await loadClient();
    await expect(postBundle(bundle, { token: '' as unknown as string })).rejects.toThrow(
      'OAuth token is required',
    );
  });

  it('sends bundle with correct headers and parses success body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: vi.fn().mockReturnValue('Observation/123') },
      json: vi.fn().mockResolvedValue({ resourceType: 'Bundle', id: 'abc' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'token-123' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fhir.test/api',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/fhir+json',
          Accept: 'application/fhir+json',
        },
        body: JSON.stringify(bundle),
        signal: expect.any(AbortSignal),
      })
    );
    expect(result).toEqual({
      ok: true,
      status: 201,
      json: { resourceType: 'Bundle', id: 'abc' },
      location: 'Observation/123',
    });
  });

  it('handles success responses without JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockRejectedValue(new Error('No body')),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result).toEqual({ ok: true, status: 200, json: undefined, location: undefined });
  });

  it('parses OperationOutcome on error responses', async () => {
    const outcome = {
      resourceType: 'OperationOutcome',
      issue: [
        { severity: 'error', code: 'invalid', diagnostics: 'Bad data' },
        { severity: 'warning', code: 'processing' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: vi.fn().mockReturnValue(undefined) },
      json: vi.fn().mockResolvedValue(outcome),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.issue).toEqual(outcome.issue);
    expect(result.json).toEqual(outcome);
  });

  it('returns json undefined when error body cannot be parsed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: vi.fn().mockReturnValue(undefined) },
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result).toEqual({ ok: false, status: 500, json: undefined, issue: undefined, location: undefined });
  });
});
