import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    delete process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS;
  });

  it('returns an error when token is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: '' as unknown as string });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.issue?.[0]?.diagnostics).toContain('OAuth token is required');
  });

  it('sends bundle with correct headers and parses success body', async () => {
    const response = new Response(JSON.stringify({ resourceType: 'Bundle', id: 'abc' }), {
      status: 201,
      headers: { Location: 'Observation/123', 'Content-Type': 'application/fhir+json' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'token-123' });

    expect(fetchMock).toHaveBeenCalledWith('https://fhir.test/api/Bundle', expect.any(Object));
    expect(result).toEqual({
      ok: true,
      status: 201,
      json: { resourceType: 'Bundle', id: 'abc' },
      location: 'Observation/123',
    });
  });

  it('handles success responses without JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(undefined, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { 'Content-Type': 'application/fhir+json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.issue).toEqual(outcome.issue);
    expect(result.json).toEqual(outcome);
    expect(result.outcome).toEqual(outcome);
    expect(result.message).toContain('Bad data');
  });

  it('preserves 403 responses instead of collapsing them into 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.issue?.[0]?.code).toBe('forbidden');
  });

  it('forces a fresh token after a real 401 before replaying the bundle', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      const headers = new Headers(init?.headers);
      if (call === 1) {
        expect(headers.get('Authorization')).toBe('Bearer stale-token');
        return new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 });
      }
      expect(headers.get('Authorization')).toBe('Bearer fresh-token');
      return new Response(JSON.stringify({ resourceType: 'Bundle', id: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/fhir+json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { configureFHIRClient, postBundle } = await loadClient();
    const refreshSpy = vi.fn(async (reason?: string) => {
      expect(reason).toBe('401');
      return 'fresh-token';
    });

    configureFHIRClient({
      ensureFreshToken: refreshSpy,
      logout: vi.fn(),
    });

    const result = await postBundle(bundle, { token: 'stale-token' });

    expect(result).toEqual({
      ok: true,
      status: 200,
      json: { resourceType: 'Bundle', id: 'ok' },
      location: undefined,
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('calls logout only once when replay still fails with %s after refresh', async (finalStatus) => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return new Response(
        JSON.stringify({ detail: finalStatus === 403 ? 'Forbidden' : 'Unauthorized' }),
        {
          status: call === 1 ? 401 : finalStatus,
          headers: { 'Content-Type': 'application/fhir+json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { configureFHIRClient, postBundle } = await loadClient();
    const logoutSpy = vi.fn();

    configureFHIRClient({
      ensureFreshToken: vi.fn(async () => 'fresh-token'),
      logout: logoutSpy,
    });

    const result = await postBundle(bundle, { token: 'stale-token' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(finalStatus);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns json undefined when error body cannot be parsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('invalid json', { status: 500, headers: { 'Content-Type': 'application/fhir+json' } }),
      );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result).toEqual({
      ok: false,
      status: 500,
      json: undefined,
      issue: undefined,
      issues: undefined,
      location: undefined,
      message: 'HTTP 500',
      outcome: undefined,
    });
  });

  it('returns validation error without performing fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const invalidBundle = { resourceType: 'Bundle', type: 'transaction' };

    const result = await postBundle(invalidBundle, { token: 'tk' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.issues?.[0]?.diagnostics).toContain('entry');
  });

  it('uses Authorization header without requiring token', async () => {
    const response = new Response(JSON.stringify({ resourceType: 'Bundle', id: 'abc' }), {
      status: 201,
      headers: { Location: 'Observation/123', 'Content-Type': 'application/fhir+json' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { headers: { Authorization: 'Bearer T' } });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
  });

  it('preserves transport failures as status 0 so replay can retry them', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS = '0';
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const { postBundle } = await loadClient();

    const result = await postBundle(bundle, { token: 'tk' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.issue?.[0]?.code).toBe('network');
  });
});
