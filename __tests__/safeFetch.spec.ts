import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeNetError } from '@/src/lib/net-errors';
import { HTTPError, TimeoutError, safeFetchOrThrow } from '@/src/lib/net';

describe('safeFetchOrThrow', () => {
  const TEST_URL = 'https://api.example.test/resource';
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('throws HTTPError with retryAfterMs when server responds 401 with Retry-After header', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('unauthorized', { status: 401, headers: { 'Retry-After': '5' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(safeFetchOrThrow(TEST_URL)).rejects.toMatchObject<Partial<HTTPError>>({
      status: 401,
      retryAfterMs: 5000,
      url: TEST_URL,
    });
  });

  it('surfaces timeout errors that normalize as TIMEOUT', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await safeFetchOrThrow(TEST_URL, { timeoutMs: 10, retries: 0 }).catch((err) => err);
    expect(error).toBeInstanceOf(TimeoutError);
    const normalized = normalizeNetError(error, { url: TEST_URL });
    expect(normalized.kind).toBe('TIMEOUT');
  });

  it('normalizes HTTP 504 responses', async () => {
    const fetchMock = vi.fn(async () => new Response('gateway timeout', { status: 504 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await safeFetchOrThrow(TEST_URL).catch((err) => err);
    expect(error).toBeInstanceOf(HTTPError);
    const normalized = normalizeNetError(error);
    expect(normalized.kind).toBe('HTTP');
    expect(normalized.status).toBe(504);
  });

  it('marks network failures as OFFLINE via normalizeNetError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const error = await safeFetchOrThrow(TEST_URL).catch((err) => err);
    const normalized = normalizeNetError(error, { url: TEST_URL });
    expect(normalized.kind).toBe('OFFLINE');
  });
});
