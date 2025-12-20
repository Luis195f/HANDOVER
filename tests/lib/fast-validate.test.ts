import { afterEach, describe, expect, it, vi } from 'vitest';

import { fastValidateBundleRemotely, hasNetwork } from '@/src/lib/fast-validate';
import * as fhirClient from '@/src/lib/fhir-client';

describe('fastValidateBundleRemotely', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks enqueue when the server returns fatal errors', async () => {
    vi.spyOn(fhirClient, 'fetchFHIR').mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 422 }),
      status: 422,
      outcome: [{ severity: 'error', diagnostics: 'bad data', expression: ['Bundle.entry'] }],
      message: 'bad data',
    } as any);

    const result = await fastValidateBundleRemotely({}, { token: 't', fhirBaseUrl: 'https://fhir.test' });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('bad data');
  });

  it('allows enqueue when validation passes', async () => {
    vi.spyOn(fhirClient, 'fetchFHIR').mockResolvedValue({
      ok: true,
      response: new Response(null, { status: 200 }),
      status: 200,
    } as any);

    const result = await fastValidateBundleRemotely({}, { token: 't', fhirBaseUrl: 'https://fhir.test' });
    expect(result.ok).toBe(true);
  });
});

describe('hasNetwork', () => {
  it('checks for connectivity and reachability', () => {
    expect(hasNetwork({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(hasNetwork({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(hasNetwork({ isConnected: false, isInternetReachable: true })).toBe(false);
  });
});
