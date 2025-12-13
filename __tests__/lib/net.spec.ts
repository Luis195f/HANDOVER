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
      retries: 1,
      backoffMs: 0,
      backoffFactor: 1,
      maxBackoffMs: 0,
      random: () => 0,
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
      retries: 0,
    });

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza HTTPError en estados no recuperables', async () => {
    const fetchMock = vi.fn(async () => new Response('fail', { status: 404 }));

    await expect(
      safeFetch('https://api/not-found', { fetchImpl: fetchMock, retries: 0 })
    ).rejects.toBeInstanceOf(HTTPError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
