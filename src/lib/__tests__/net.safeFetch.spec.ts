import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch, HTTPError, NetworkError, TimeoutError } from '../net';

const HTTPS_URL = 'https://api.example.test/resource';

describe('safeFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('throws TimeoutError when request exceeds timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));

    const promise = safeFetch(HTTPS_URL, { fetchImpl: fetchMock, timeoutMs: 500 });

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and respects Retry-After header before succeeding', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response('fail', { status: 503, headers: { 'Retry-After': '1' } }),
      new Response('ok', { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);

    const resultPromise = safeFetch(HTTPS_URL, {
      fetchImpl: fetchMock,
      maxRetries: 1,
      random: () => 0.1,
    });

    await vi.advanceTimersByTimeAsync(1000);

    const res = await resultPromise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws HTTPError after exhausting retries on 502', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('fail', { status: 502 }));

    await expect(
      safeFetch(HTTPS_URL, { fetchImpl: fetchMock, maxRetries: 0 })
    ).rejects.toBeInstanceOf(HTTPError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkError on fetch rejection', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network down');
    });

    await expect(safeFetch(HTTPS_URL, { fetchImpl: fetchMock })).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces HTTPS in production except for localhost allowlist', async () => {
    process.env.NODE_ENV = 'production';

    await expect(safeFetch('http://example.com', { fetchImpl: vi.fn() as any })).rejects.toBeInstanceOf(NetworkError);

    const localhostFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const res = await safeFetch('http://localhost:8080', { fetchImpl: localhostFetch });
    expect(res.status).toBe(200);
  });
});
