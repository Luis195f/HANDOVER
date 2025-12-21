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
    vi.useRealTimers();
    const signals: AbortSignal[] = [];
    const abortError = () => {
      try {
        return new DOMException('Aborted', 'AbortError');
      } catch {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return error;
      }
    };
    const fetchMock = vi.fn().mockImplementation((_: RequestInfo, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signals.push(signal);
      }

      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        const fallback = setTimeout(onAbort, 50);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(fallback);
            onAbort();
          },
          { once: true },
        );

        if (fetchMock.mock.calls.length > 1) {
          clearTimeout(fallback);
          resolve(new Response('ok', { status: 200 }));
        }
      });
    });

    const promise = safeFetch('https://example.com', {
      timeoutMs: 5,
      retry: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(promise).resolves.toHaveProperty('status', 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
