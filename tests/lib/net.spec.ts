import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { HTTPError, NetworkError, safeFetch } from '@/src/lib/net';

const HTTPS_URL = 'https://example.com/resource';

describe('safeFetch (network layer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('blocks plain HTTP in production except for local hosts', async () => {
    process.env.NODE_ENV = 'production';

    await expect(safeFetch('http://example.com', { fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toBeInstanceOf(
      NetworkError
    );

    const localhostFetch = vi.fn(async () => new Response('ok'));
    const res = await safeFetch('http://localhost:8080', { fetchImpl: localhostFetch });
    expect(res.ok).toBe(true);
    expect(localhostFetch).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('fail', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));

    const promise = safeFetch(HTTPS_URL, { fetchImpl: fetchMock, maxRetries: 1, backoffMs: 50, random: () => 0 });

    await vi.advanceTimersByTimeAsync(50);

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient 4xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400, statusText: 'Bad Request' }));

    await expect(safeFetch(HTTPS_URL, { fetchImpl: fetchMock, retries: 3 })).rejects.toBeInstanceOf(HTTPError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds Idempotency-Key header when provided', async () => {
    const fetchMock = vi.fn(async (_: RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Idempotency-Key')).toBe('abc-123');
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await safeFetch<{ ok: boolean }>(HTTPS_URL, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      idempotencyKey: 'abc-123',
    });

    expect(res.data?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
