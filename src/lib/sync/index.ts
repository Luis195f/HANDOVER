// FILE: src/lib/sync/index.ts
// ---------------------------------------------------------------------
// FHIR sync with offline-first behavior, backoff, and idempotency.
// Includes telemetry (mark) and UI helpers (flushQueue / getQueueSize).
//
// Exports:
//   - syncBundleOrEnqueue(bundle, opts): 'sent' | 'queued'
//   - startSyncDaemon(opts): () => void   (subscribes to network changes and drains)
//   - flushQueue(opts): { processed, remaining }     (manual "Retry now" action)
//   - getQueueSize(): Promise<number>     (for banners/indicators)
// ---------------------------------------------------------------------

import NetInfo from '@/src/lib/netinfo';
import { configureFHIRClient, postBundle } from '../fhir-client';
import {
  validateBundle as validateFHIRBundle,
  validateResourceWithZod,
  type ValidationResult,
} from '../fhir-validation/zod';
import { retryWithBackoff } from './backoff';
import { bundleIdempotencyKey } from './ident';
import { enqueueTx, flushQueue as runQueueFlush, readQueue } from '../offlineQueue';

// --- Tolerant mark(): no-op when the otel module is not available. ---
type MarkFn = (name: string, attrs?: Record<string, unknown>) => void;
let mark: MarkFn = () => {};
try {
  const mod = require('@/src/lib/otel') as { mark?: MarkFn };
  if (mod?.mark) mark = mod.mark;
} catch {}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
type ValidationErrorDetail = ValidationResult['errors'][number];

function enforceBundleValidation(bundle: unknown, context: string): ValidationErrorDetail[] {
  const result = validateFHIRBundle(bundle);
  if (!result.isValid) {
    const error = new Error(`FHIR bundle validation failed (${context}): ${JSON.stringify(result.errors)}`);
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = result.errors;
    if (bundle && typeof bundle === 'object') {
      (bundle as Record<string, unknown>)._validationErrors = result.errors;
    }
    throw error;
  }

  const fhirValidation = validateResourceWithZod(bundle);
  if (!fhirValidation.isValid) {
    const mappedErrors = fhirValidation.errors;
    const error = new Error(
      `FHIR structure validation failed (${context}): ${mappedErrors.map((err) => err.message).join('; ')}`
    );
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = mappedErrors;
    if (bundle && typeof bundle === 'object') {
      (bundle as Record<string, unknown>)._validationErrors = mappedErrors;
    }
    throw error;
  }

  if (bundle && typeof bundle === 'object' && '_validationErrors' in bundle) {
    delete (bundle as Record<string, unknown>)._validationErrors;
  }
  return [];
}
try {
  const mod = require('../otel');
  if (mod?.mark) mark = mod.mark as MarkFn;
} catch {}

// --- HTTP statuses of interest ---
function isSuccessStatus(status: number) {
  return status === 200 || status === 201 || status === 202 || status === 204;
}
function isDuplicateSkip(status: number) {
  return status === 412; // If-None-Exist -> duplicado saltado (OK lógico)
}
function isRetryable(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// --- Public types ---
export type SyncOpts = {
  fhirBaseUrl: string;
  getToken: () => Promise<string | null>;
  backoff?: { retries?: number; minMs?: number; maxMs?: number };
};

export type FlushOutcome =
  | 'success'
  | 'auth-required'
  | 'auth-failed'
  | 'network-error'
  | 'server-error'
  | 'client-error';

export type FlushResult = {
  processed: number;
  remaining: number;
  outcome: FlushOutcome;
  status?: number;
};

class QueueReplayAuthError extends Error {
  readonly nonRetryable = true;

  constructor(
    readonly outcome: Extract<FlushOutcome, 'auth-required' | 'auth-failed'>,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'QueueReplayAuthError';
  }
}

// Global guard to coalesce concurrent flushes (prevents races).
let _currentFlush: Promise<FlushResult> | null = null;
const RECENTLY_SYNCED_QUEUE_ITEM_TTL_MS = 5 * 60_000;
const recentlySyncedQueueItems = new Map<string, number>();

function pruneRecentlySyncedQueueItems(now = Date.now()): void {
  for (const [id, expiresAt] of recentlySyncedQueueItems.entries()) {
    if (expiresAt <= now) {
      recentlySyncedQueueItems.delete(id);
    }
  }
}

function rememberRecentlySyncedQueueItem(id: string): void {
  const now = Date.now();
  pruneRecentlySyncedQueueItems(now);
  recentlySyncedQueueItems.set(id, now + RECENTLY_SYNCED_QUEUE_ITEM_TTL_MS);
}

export function consumeRecentlySyncedQueueItem(id: string): boolean {
  const now = Date.now();
  pruneRecentlySyncedQueueItems(now);
  const expiresAt = recentlySyncedQueueItems.get(id);
  if (!expiresAt || expiresAt <= now) {
    recentlySyncedQueueItems.delete(id);
    return false;
  }
  recentlySyncedQueueItems.delete(id);
  return true;
}

// --- Main API: send immediately or enqueue when offline or on error. ---
export async function syncBundleOrEnqueue(
  bundle: unknown,
  opts: SyncOpts
): Promise<'sent' | 'queued'> {
  enforceBundleValidation(bundle, 'syncBundleOrEnqueue');
  const online = await hasInternet();
  const idemKey = bundleIdempotencyKey(bundle);
  if (!online) {
    await enqueue(bundle, idemKey);
    return 'queued';
  }

  try {
    configureFHIRClient({
      getBaseUrl: () => opts.fhirBaseUrl,
      ensureFreshToken: async () => (await opts.getToken()) ?? null,
    });
    await sendWithRetry(bundle, idemKey, opts);
    return 'sent';
  } catch {
    await enqueue(bundle, idemKey);
    return 'queued';
  }
}

// --- Send with backoff + per-attempt marks. ---
async function sendWithRetry(bundle: unknown, idemKey: string, opts: SyncOpts) {
  enforceBundleValidation(bundle, 'sync sendWithRetry');
  return await retryWithBackoff(
    async (attempt) => {
      mark('sync.http.request', { attempt, idemKey });
      const token = await requireFreshSessionToken(opts);
      const resp = await postBundle(bundle, {
        token,
        headers: { 'Idempotency-Key': idemKey },
      });
      mark('sync.http.response', { status: resp.status, attempt });

      if (resp.status === 401 || resp.status === 403) {
        throw new QueueReplayAuthError('auth-required', resp.status, `HTTP ${resp.status}`);
      }
      if (isSuccessStatus(resp.status) || isDuplicateSkip(resp.status)) {
        return resp;
      }
      if (isRetryable(resp.status)) {
        const error = new Error(`Retryable ${resp.status}`) as Error & { status?: number };
        error.status = resp.status;
        throw error;
      }

      const body = resp.body ? JSON.stringify(resp.body) : '';
      const error = new Error(`Non-retryable HTTP ${resp.status} ${body}`) as Error & { status?: number };
      error.status = resp.status;
      throw error;
    },
    opts.backoff
  );
}

// --- Enqueue (encrypted) + telemetry mark. ---
async function enqueue(bundle: unknown, idemKey: string) {
  mark('sync.enqueue', { kind: 'FHIR_BUNDLE', idemKey });
  enforceBundleValidation(bundle, 'sync enqueue');
  await enqueueTx({ payload: { bundle, meta: { hash: idemKey } } });
}

// --- Network state ---
async function hasInternet(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return !!(s.isConnected && (s.isInternetReachable ?? true));
}

async function requireFreshSessionToken(opts: SyncOpts): Promise<string> {
  let token: string | null;
  try {
    token = await opts.getToken();
  } catch (error) {
    throw new QueueReplayAuthError(
      'auth-failed',
      401,
      error instanceof Error ? error.message : 'Failed to refresh bearer for queue replay',
    );
  }

  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new QueueReplayAuthError('auth-required', 401, 'Fresh bearer required for queue replay');
  }

  return token;
}

function resolveFlushOutcome(status?: number): FlushOutcome {
  if (status === 401 || status === 403) return 'auth-required';
  if (status == null || status === 0) return 'network-error';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  return 'success';
}

/** Builds a reusable flush function for both the daemon and manual actions. */
function createFlusher(opts: SyncOpts) {
  configureFHIRClient({
    getBaseUrl: () => opts.fhirBaseUrl,
    ensureFreshToken: async () => (await opts.getToken()) ?? null,
  });

  return async function flushImpl(): Promise<FlushResult> {
    mark('sync.flush.start');
    try {
      await requireFreshSessionToken(opts);
    } catch (error) {
      if (error instanceof QueueReplayAuthError) {
        return {
          processed: 0,
          remaining: (await readQueue()).length,
          outcome: error.outcome,
          status: error.status,
        };
      }
      return {
        processed: 0,
        remaining: (await readQueue()).length,
        outcome: 'auth-failed',
        status: 401,
      };
    }

    let processed = 0;
    let outcome: FlushOutcome = 'success';
    let status: number | undefined;

    await runQueueFlush(async (tx) => {
      const payload =
        tx.payload && typeof tx.payload === 'object'
          ? (tx.payload as { bundle?: unknown; meta?: { hash?: string } })
          : {};
      const bundle = payload.bundle;
      const hash = payload.meta?.hash ?? tx.key;

      if (!bundle) {
        if (outcome === 'success') {
          outcome = 'client-error';
          status = 422;
        }
        return { ok: false, status: 422 };
      }

      try {
        const resp = await sendWithRetry(bundle, hash, opts);
        if (resp.ok || isSuccessStatus(resp.status) || isDuplicateSkip(resp.status)) {
          processed++;
          rememberRecentlySyncedQueueItem(tx.id);
        } else if (outcome === 'success') {
          outcome = resolveFlushOutcome(resp.status);
          status = resp.status;
        }
        return { ok: resp.ok, status: resp.status };
      } catch (err: unknown) {
        if (err instanceof QueueReplayAuthError) {
          outcome = err.outcome;
          status = err.status;
          mark('sync.flush.error', {
            reason: err.message,
            tries: tx.tries,
            id: tx.key,
          });
          return { ok: false, status: err.status, stop: true };
        }

        const errorStatus =
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          typeof (err as { status?: unknown }).status === 'number'
            ? (err as { status: number }).status
            : 0;
        if (outcome === 'success') {
          outcome = resolveFlushOutcome(errorStatus);
          status = errorStatus || undefined;
        }
        mark('sync.flush.error', {
          reason: err instanceof Error ? err.message : String(err),
          tries: tx.tries,
          id: tx.key,
        });
        return { ok: false, status: errorStatus || 500 };
      }
    });

    const remaining = (await readQueue()).length;
    if (processed > 0) {
      mark('sync.flush.success', {
        drained: remaining === 0,
        processed,
        remaining,
      });
    }
    return { processed, remaining, outcome, status };
  };
}

// Coalesce concurrent flushes (same module instance).
async function triggerFlush(opts: SyncOpts): Promise<FlushResult> {
  if (_currentFlush) return _currentFlush;
  const flush = createFlusher(opts);
  _currentFlush = flush()
    .catch((e) => {
      // Propagamos error pero limpiamos lock
      throw e;
    })
    .finally(() => {
      _currentFlush = null;
    });
  return _currentFlush;
}

export function startSyncDaemon(opts: SyncOpts) {
  const unsub = NetInfo.addEventListener((state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
    if (state.isConnected && (state.isInternetReachable ?? true)) {
      // Coalesce multiple trigger attempts.
      triggerFlush(opts).catch(() => {});
    }
  });

  // Initial attempt (in case the app starts with connectivity).
  triggerFlush(opts).catch(() => {});
  return () => unsub();
}

/**
 * Flushes the queue on demand (e.g., from the Sync Center UI).
 */
export async function flushQueue(opts: SyncOpts): Promise<FlushResult> {
  return triggerFlush(opts);
}

/**
 * @deprecated Use {@link flushQueue} instead. This alias will be removed in a future major release.
 */
export async function flushQueueNow(opts: SyncOpts): Promise<FlushResult> {
  return flushQueue(opts);
}

/** Returns the current queue size (for banners/UI). */
export async function getQueueSize(): Promise<number> {
  try {
    const queue = await readQueue();
    return queue.length;
  } catch {
    return -1;
  }
}
