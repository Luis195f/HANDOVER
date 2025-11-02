import { fetchWithRetry } from '@/src/lib/net';

describe('fetchWithRetry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  test('resolves immediately when status not in retry list', async () => {
    const mockFetch = jest.fn(async () => ({ ok: true, status: 201 }) as Response);
    global.fetch = mockFetch as any;
    const res = await fetchWithRetry('https://example.com');
    expect(res.status).toBe(201);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('retries on configured statuses and eventually succeeds', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    global.fetch = mockFetch as any;
    const res = await fetchWithRetry('https://api.example.com', {}, { retries: 1, backoffMs: 1 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('propagates the last error when retries exhausted', async () => {
    const error = new Error('network down');
    const mockFetch = jest.fn(async () => {
      throw error;
    });
    global.fetch = mockFetch as any;
    await expect(fetchWithRetry('https://fail.example.com', {}, { retries: 1 })).rejects.toThrow(
      'network down'
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('passes through provided AbortSignal', async () => {
    const controller = new AbortController();
    const mockFetch = jest.fn(async (_input, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return { ok: true, status: 200 } as Response;
    });
    global.fetch = mockFetch as any;
    const res = await fetchWithRetry('https://signal.test', {}, { signal: controller.signal });
    expect(res.status).toBe(200);
  });
});
