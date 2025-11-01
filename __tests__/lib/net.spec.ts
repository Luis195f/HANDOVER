import { describe, expect, it, vi } from 'vitest';

import { NetworkError, safeFetch } from '@/src/lib/net';
import { __test__ as syncTestUtils } from '@/src/lib/sync';

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://fhir.test',
  API_BASE: '',
  API_TOKEN: '',
  ENV: { FHIR_BASE_URL: 'https://fhir.test', API_BASE: '', API_TOKEN: '' },
}));

describe('safeFetch', () => {
  it('reintenta solicitudes que agotan el timeout', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const promise = safeFetch('https://api.example.com/resource', {
      fetchImpl: fetchMock,
      timeoutMs: 10,
      baseDelayMs: 0,
      maxDelayMs: 0,
      random: () => 0,
    });

    await vi.advanceTimersByTimeAsync(15);
    const response = await promise;

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('vuelve a intentar ante respuestas HTTP retryable', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response('busy', { status: 503, headers: { 'retry-after': '0.01' } });
      }
      return new Response('ok', { status: 200 });
    });

    const promise = safeFetch('https://api.example.com/retry', {
      fetchImpl: fetchMock,
      timeoutMs: 100,
      baseDelayMs: 1,
      maxDelayMs: 1,
      random: () => 0,
    });

    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('bloquea HTTP sin cifrar en producción', async () => {
    const fetchMock = vi.fn();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await expect(
      safeFetch('http://malicious.example.com/data', { fetchImpl: fetchMock })
    ).rejects.toBeInstanceOf(NetworkError);

    process.env.NODE_ENV = previous;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ensureBundleTx idempotencia', () => {
  it('agrega txId a ifNoneExist conservando valores previos', () => {
    const { ensureBundleTx } = syncTestUtils;
    const base = {
      resourceType: 'Bundle' as const,
      entry: [
        { request: { method: 'POST', url: 'Patient' } },
        { request: { method: 'POST', url: 'Observation', ifNoneExist: 'identifier=system|value' } },
      ],
    };

    const { txId, bundle } = ensureBundleTx(base, undefined);

    expect(txId).toMatch(/[0-9a-f\-]{36}/);
    expect(bundle.identifier?.value).toBe(txId);
    expect(bundle.entry?.[0].request.ifNoneExist).toContain(txId);
    expect(bundle.entry?.[1].request.ifNoneExist).toContain('identifier=system|value');
    expect(bundle.entry?.[1].request.ifNoneExist).toContain(txId);
  });
});
