import { fetchWithRetry } from '@/src/lib/net';

describe('fetchWithRetry', () => {
  test('rejects insecure url in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(fetchWithRetry('http://example.com')).rejects.toThrow(/HTTPS is required/);
  });

  test('allows localhost over http when not production', async () => {
    process.env.NODE_ENV = 'development';
    const mockFetch = jest.fn(async () => ({ ok: true, status: 200 })) as any;
    const response = await fetchWithRetry('http://localhost/api', { fetchImpl: mockFetch });
    expect(response.status).toBe(200);
  });

  test('retries on transient failures', async () => {
    process.env.NODE_ENV = 'production';
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const response = await fetchWithRetry('https://api.example.com', {
      fetchImpl: mockFetch as any,
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 2 },
    });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('aborts when timeout elapses', async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    const mockFetch = jest.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const promise = fetchWithRetry('https://slow.example.com', {
      fetchImpl: mockFetch as any,
      timeoutMs: 10,
      retry: 0,
    });
    jest.advanceTimersByTime(20);
    await expect(promise).rejects.toThrow('aborted');
    jest.useRealTimers();
  });
});
