import { describe, expect, it, vi, afterEach } from 'vitest';

import { HTTPError, safeFetchOrThrow } from '@/src/lib/net';
import { normalizeNetError } from '@/src/lib/net-errors';

describe('safeFetchOrThrow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws HTTPError with retryAfter metadata on 401 responses', async () => {
    const unauthorizedResponse = new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Retry-After': '5' },
    });
    Object.defineProperty(unauthorizedResponse, 'url', { value: 'https://api.example.com/login' });
    const fetchMock = vi.fn().mockResolvedValue(unauthorizedResponse);

    await expect(
      safeFetchOrThrow('https://api.example.com/login', { fetchImpl: fetchMock, parseJson: false }),
    ).rejects.toMatchObject({ status: 401, retryAfterMs: 5000, url: 'https://api.example.com/login' });
  });

  it('classifies timeout aborts as timeout errors', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_, init: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const promise = safeFetchOrThrow('https://api.example.com/slow', {
      fetchImpl: fetchMock,
      timeoutMs: 10,
      parseJson: false,
      retries: 0,
    }).catch((err) => err as Error);

    await vi.advanceTimersByTimeAsync(20);
    const error = (await promise) as Error;
    expect(error?.name).toBe('TimeoutError');
    const normalized = normalizeNetError(error, { url: 'https://api.example.com/slow' });
    expect(normalized.kind).toBe('TIMEOUT');
  });

  it('maps HTTP 504 responses to HTTP errors', async () => {
    const gatewayTimeoutResponse = new Response('Gateway Timeout', { status: 504, statusText: 'Gateway Timeout' });
    Object.defineProperty(gatewayTimeoutResponse, 'url', { value: 'https://api.example.com/jobs' });
    const fetchMock = vi.fn().mockResolvedValue(gatewayTimeoutResponse);

    const err = await safeFetchOrThrow('https://api.example.com/jobs', { fetchImpl: fetchMock, parseJson: false }).catch(
      (error) => error as HTTPError,
    );
    expect(err).toBeInstanceOf(HTTPError);
    const normalized = normalizeNetError(err, { response: err.response });
    expect(normalized.kind).toBe('HTTP');
    expect(normalized.status).toBe(504);
  });

  it('detects offline errors from fetch failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network request failed'));

    const err = await safeFetchOrThrow('https://api.example.com/offline', {
      fetchImpl: fetchMock,
      parseJson: false,
      retries: 0,
    }).catch((error) => error);

    const normalized = normalizeNetError(err, { url: 'https://api.example.com/offline' });
    expect(normalized.kind).toBe('OFFLINE');
  });
});
