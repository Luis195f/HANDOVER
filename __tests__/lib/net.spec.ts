import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTTPError, TimeoutError, safeFetch } from '@/src/lib/net';

describe('safeFetch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reintenta en 503 y luego ok', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('', { status: 503 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const response = await safeFetch('https://api/foo', {
      fetchImpl: fetchMock,
      retry: { retries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('timeout lanza TimeoutError', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));

    const promise = safeFetch('https://api/slow', {
      fetchImpl: fetchMock,
      timeoutMs: 10,
      retry: { retries: 0 },
    });

    await vi.advanceTimersByTimeAsync(20);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza HTTPError en estados no recuperables', async () => {
    const fetchMock = vi.fn(async () => new Response('fail', { status: 404 }));

    await expect(
      safeFetch('https://api/not-found', { fetchImpl: fetchMock, retry: { retries: 0 } })
    ).rejects.toBeInstanceOf(HTTPError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
