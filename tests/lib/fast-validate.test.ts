import { afterEach, describe, expect, it, vi } from 'vitest';

import { fastValidateBundleRemotely, hasNetwork } from '@/src/lib/fast-validate';
import * as fhirClient from '@/src/lib/fhir-client';

describe('fastValidateBundleRemotely', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks enqueue when the server returns fatal errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 422 }),
      status: 422,
      outcome: [{ severity: 'error', diagnostics: 'bad data', expression: ['Bundle.entry'] }],
      message: 'bad data',
    } as any);
    vi.spyOn(fhirClient, 'createFHIRClient').mockReturnValue({ fetchFHIR: fetchMock } as any);

    const result = await fastValidateBundleRemotely({}, { token: 't', fhirBaseUrl: 'https://fhir.test' });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('bad data');
    expect(fetchMock).toHaveBeenCalledWith({
      path: '/Bundle/$validate',
      method: 'POST',
      body: {},
      token: 't',
    });
  });

  it('allows enqueue when validation passes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      response: new Response(null, { status: 200 }),
      status: 200,
    } as any);
    vi.spyOn(fhirClient, 'createFHIRClient').mockReturnValue({ fetchFHIR: fetchMock } as any);

    const result = await fastValidateBundleRemotely({}, { token: 't', fhirBaseUrl: 'https://fhir.test' });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith({
      path: '/Bundle/$validate',
      method: 'POST',
      body: {},
      token: 't',
    });
  });

  it('does not mutate or rely on global FHIR client configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      response: new Response(null, { status: 200 }),
      status: 200,
    } as any);

    const configureSpy = vi.spyOn(fhirClient, 'configureFHIRClient').mockImplementation(() => {
      throw new Error('configureFHIRClient should not be called');
    });
    const globalFetchSpy = vi.spyOn(fhirClient, 'fetchFHIR').mockImplementation(() => {
      throw new Error('global fetchFHIR should not be used');
    });
    const createClientSpy = vi.spyOn(fhirClient, 'createFHIRClient').mockReturnValue({
      fetchFHIR: fetchMock,
    } as any);

    const result = await fastValidateBundleRemotely({}, { token: 'scoped-token', fhirBaseUrl: 'https://scoped.test' });

    expect(result.ok).toBe(true);
    expect(configureSpy).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(createClientSpy).toHaveBeenCalledWith({
      baseUrl: expect.any(Function),
      getToken: expect.any(Function),
    });
    expect(fetchMock).toHaveBeenCalledWith({
      path: '/Bundle/$validate',
      method: 'POST',
      body: {},
      token: 'scoped-token',
    });
  });
});

describe('hasNetwork', () => {
  it('checks for connectivity and reachability', () => {
    expect(hasNetwork({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(hasNetwork({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(hasNetwork({ isConnected: false, isInternetReachable: true })).toBe(false);
  });
});
