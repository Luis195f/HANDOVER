// src/lib/net.ts
import { maybeUseDemoResponse } from '@/src/demo/net-interceptor';

export type RetryOptions = {
  retries?: number;
  backoffMs?: number;
  retryOn?: number[];
  signal?: AbortSignal;
};

export interface ExtendedRequestInit extends RequestInit {
  fetchImpl?: typeof fetch;
  retry?: number | {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  timeoutMs?: number;
}

export type SafeFetchOptions = RequestInit & {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retry?: number;
  maxRetries?: number;
  backoffMs?: number;
  backoffFactor?: number;
  maxBackoffMs?: number;
  retryOn?: number[];
  idempotencyKey?: string;
  parseJson?: boolean;
  random?: () => number;
};

export type SafeResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  data?: T;
  raw: Response;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_RETRYABLE = [408, 429, 500, 502, 503, 504];
const envRetryMax = Number.parseInt(process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS || '', 10);
const DEFAULT_RETRIES = Number.isFinite(envRetryMax) ? envRetryMax : 3;
const envBackoff = Number.parseInt(process.env.EXPO_PUBLIC_QUEUE_BACKOFF_BASE || '', 10);
const DEFAULT_BACKOFF_MS = Number.isFinite(envBackoff) ? envBackoff : 500;
const DEFAULT_BACKOFF_FACTOR = 2;

function isHttpUrlAllowedInProd(url: URL) {
  return (
    url.hostname === 'localhost' ||
    url.hostname.startsWith('127.') ||
    url.hostname.startsWith('10.') ||
    url.hostname.startsWith('192.168.')
  );
}

export class NetworkError extends Error {
  status?: number;
  code?: string;
  isTransient: boolean;
  details?: unknown;
  url?: string;
  retryAfterMs?: number;
  cause?: unknown;

  constructor(
    message: string,
    params: {
      status?: number;
      code?: string;
      isTransient?: boolean;
      details?: unknown;
      url?: string;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'NetworkError';
    this.status = params.status;
    this.code = params.code;
    this.isTransient = params.isTransient ?? false;
    this.details = params.details;
    this.url = params.url;
    this.retryAfterMs = params.retryAfterMs;
    this.cause = params.cause;
  }
}

export class TimeoutError extends NetworkError {
  constructor(message = 'Request timed out', options: { cause?: unknown; url?: string } = {}) {
    super(message, { code: 'TIMEOUT', isTransient: true, cause: options.cause, url: options.url });
    this.name = 'TimeoutError';
  }
}

export class HTTPError extends NetworkError {
  response?: Response;
  retryAfterMs?: number;

  constructor(
    status: number,
    statusText: string,
    isTransient: boolean,
    response?: Response,
    retryAfterMs?: number,
    url?: string,
    cause?: unknown,
  ) {
    super(statusText || `HTTP ${status}`, {
      status,
      isTransient,
      details: response,
      url: url ?? response?.url,
      retryAfterMs,
      cause,
    });
    this.name = 'HTTPError';
    this.response = response;
    this.retryAfterMs = retryAfterMs;
    this.url = url ?? response?.url;
  }
}

const buildHeaders = (headers?: HeadersInit, idempotencyKey?: string) => {
  const merged = new Headers(headers || undefined);
  if (idempotencyKey && !merged.has('Idempotency-Key')) {
    merged.set('Idempotency-Key', idempotencyKey);
  }
  return merged;
};

const shouldRetryStatus = (status: number, retryOn: number[]) => retryOn.includes(status);

const parseRetryAfter = (headers: Headers) => {
  const retryAfterHeader = headers.get('Retry-After');
  if (!retryAfterHeader) return null;
  const retryAfterSeconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds)) {
    return retryAfterSeconds * 1000;
  }
  return null;
};

const createAbortError = (cause?: unknown) => {
  const baseMessage = 'Aborted';
  if (typeof DOMException !== 'undefined') {
    try {
      return new DOMException(baseMessage, 'AbortError');
    } catch {
      /* noop */
    }
  }

  const error = new Error(baseMessage);
  error.name = 'AbortError';
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
};

const parseJsonIfPossible = async <T>(response: Response, parseJson: boolean): Promise<T | undefined> => {
  if (!parseJson) return undefined;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) return undefined;
  try {
    return (await response.clone().json()) as T;
  } catch {
    return undefined;
  }
};

export async function safeFetch<T = unknown>(input: RequestInfo | URL, options: SafeFetchOptions = {}): Promise<SafeResponse<T>> {
  const {
    fetchImpl = fetch,
    timeoutMs,
    retries,
    retry,
    maxRetries,
    backoffMs = DEFAULT_BACKOFF_MS,
    backoffFactor = DEFAULT_BACKOFF_FACTOR,
    maxBackoffMs = Number.POSITIVE_INFINITY,
    retryOn = DEFAULT_RETRYABLE,
    idempotencyKey,
    parseJson = true,
    random = Math.random,
    signal,
    ...init
  } = options;

  const resolvedRetries = retries ?? maxRetries ?? retry ?? DEFAULT_RETRIES;
  const demoResponse = await maybeUseDemoResponse(input, init as RequestInit);
  if (demoResponse) {
    const demoData = await parseJsonIfPossible<T>(demoResponse, parseJson);
    return {
      ok: demoResponse.ok,
      status: demoResponse.status,
      statusText: demoResponse.statusText,
      headers: demoResponse.headers,
      data: demoData,
      raw: demoResponse,
    };
  }
  const urlToUse = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
  const parsedUrl = (() => {
    try {
      return new URL(urlToUse);
    } catch {
      return null;
    }
  })();

  if (process.env.NODE_ENV === 'production' && parsedUrl?.protocol === 'http:' && !isHttpUrlAllowedInProd(parsedUrl)) {
    throw new NetworkError('Insecure HTTP is not allowed in production', { code: 'INSECURE_PROTOCOL', isTransient: false });
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= resolvedRetries) {
    const attemptController = new AbortController();
    const onAbort = () => attemptController.abort();
    if (signal) {
      if (signal.aborted) {
        const abortedError = new NetworkError('Request aborted', { code: 'ABORTED', isTransient: false, url: urlToUse });
        abortedError.name = 'AbortError';
        throw abortedError;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timeoutPromise: Promise<Response> | undefined;
    if (timeoutMs) {
      timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          attemptController.abort();
          reject(new TimeoutError(undefined, { url: urlToUse }));
        }, timeoutMs);
      });
    }

    try {
      const headers = buildHeaders(init.headers, idempotencyKey);
      const fetchPromise = fetchImpl(input, { ...init, headers, signal: attemptController.signal });
      let abortHandler: (() => void) | undefined;
      const racePromises: Array<Promise<Response>> = [
        fetchPromise,
        new Promise<Response>((_, reject) => {
          abortHandler = () => reject(createAbortError());
          attemptController.signal.addEventListener('abort', abortHandler!, { once: true });
        }),
      ];
      if (timeoutPromise) {
        racePromises.push(timeoutPromise);
      }
      const response = await Promise.race(racePromises);
      if (abortHandler) {
        attemptController.signal.removeEventListener('abort', abortHandler);
      }

      if (response.ok) {
        if (timeoutId) clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        const data = await parseJsonIfPossible<T>(response, parseJson);
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data,
          raw: response,
        };
      }

      const shouldRetry = shouldRetryStatus(response.status, retryOn);
      if (!shouldRetry || attempt === resolvedRetries) {
        if (timeoutId) clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        const retryAfterMs = parseRetryAfter(response.headers) ?? undefined;
        throw new HTTPError(response.status, response.statusText, shouldRetry, response, retryAfterMs, urlToUse);
      }

      const retryAfterMs = parseRetryAfter(response.headers);
      const exponentialDelay = backoffMs * Math.pow(backoffFactor, attempt);
      const jitter = Math.floor(random() * 100);
      const delay = Math.min(retryAfterMs ?? exponentialDelay + jitter, maxBackoffMs);
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
      await sleep(delay);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (error instanceof HTTPError) {
        throw error;
      }

      if (error instanceof TimeoutError) {
        if (attempt === resolvedRetries) {
          throw error;
        }
        await sleep(Math.min(backoffMs * Math.pow(backoffFactor, attempt), maxBackoffMs));
        attempt += 1;
        continue;
      }

      const isAbortError = (error as { name?: string } | undefined)?.name === 'AbortError';
      const isTimeout = isAbortError && timeoutMs !== undefined;
      lastError = error;

      if (isTimeout) {
        if (attempt === resolvedRetries) {
          throw new TimeoutError(undefined, { cause: error, url: urlToUse });
        }
        await sleep(Math.min(backoffMs * Math.pow(backoffFactor, attempt), maxBackoffMs));
        attempt += 1;
        continue;
      }

      if (isAbortError) {
        throw createAbortError(error);
      }

      if (attempt === resolvedRetries) {
        throw new NetworkError((error as Error)?.message || 'Network error', {
          isTransient: true,
          details: error,
          cause: error,
          url: urlToUse,
        });
      }

      await sleep(Math.min(backoffMs * Math.pow(backoffFactor, attempt), maxBackoffMs));
    }

    attempt += 1;
  }

  throw lastError instanceof Error ? lastError : new Error('safeFetch: exhausted retries');
}

export async function safeFetchOrThrow(input: RequestInfo | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const response = await safeFetch(input, options);
  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers) ?? undefined;
    throw new HTTPError(response.status, response.statusText, false, response.raw, retryAfterMs, response.raw.url);
  }
  return response.raw;
}

export async function fetchWithRetry(input: RequestInfo | URL, init: ExtendedRequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  const { fetchImpl, retry, timeoutMs, ...rest } = init;
  const resolvedRetries = typeof retry === 'number' ? retry : retry?.retries;
  const backoffMs = typeof retry === 'number' ? undefined : retry?.baseDelayMs;
  const maxBackoffMs = typeof retry === 'number' ? undefined : retry?.maxDelayMs;

  const response = await safeFetch(input, {
    ...rest,
    fetchImpl,
    timeoutMs,
    retries: resolvedRetries ?? opts.retries,
    backoffMs: backoffMs ?? opts.backoffMs,
    maxBackoffMs,
    retryOn: opts.retryOn,
    signal: opts.signal,
    parseJson: false,
  });

  return response.raw;
}

export default fetchWithRetry;

export * from './net-errors';
