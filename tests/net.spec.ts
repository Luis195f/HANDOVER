import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '@/src/lib/net';

describe('safeFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a new AbortController per retry when the first attempt times out', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((_: RequestInfo, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signals.push(signal);
      }

      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timeout', 'AbortError')),
            { once: true }
          );
        });
      }

      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    const promise = safeFetch('https://example.com', {
      timeoutMs: 5,
      retry: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toHaveProperty('status', 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
