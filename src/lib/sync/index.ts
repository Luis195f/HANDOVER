// FILE: src/lib/sync/index.ts
// ---------------------------------------------------------------------
// Sincronización FHIR con soporte offline-first + backoff + idempotencia
// + telemetría (mark) y utilidades para UI (flushQueueNow / getQueueSize).
//
// Exports:
//   - syncBundleOrEnqueue(bundle, opts): 'sent' | 'queued'
//   - startSyncDaemon(opts): () => void   (suscribe cambios de red y drena)
//   - flushQueueNow(opts): { processed, remaining }  (botón "Reintentar ahora")
//   - getQueueSize(): Promise<number>     (para banner)
// ---------------------------------------------------------------------

import NetInfo from '@/src/lib/netinfo';
import { configureFHIRClient, postBundle } from '../fhir-client';
import { logger } from '../logger';
import { retryWithBackoff } from './backoff';
import { bundleIdempotencyKey } from './ident';
import { enqueueTx, flushQueue as runQueueFlush, readQueue } from '../offlineQueue';

// --- mark() tolerante: no-op si el módulo de otel no está disponible ---
type MarkFn = (name: string, attrs?: Record<string, any>) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mark: MarkFn = () => {};
try {
  // @ts-ignore – alias de paths
  const mod = require('@/src/lib/otel');
  if (mod?.mark) mark = mod.mark as MarkFn;
} catch {}
try {
  const mod = require('../otel');
  if (mod?.mark) mark = mod.mark as MarkFn;
} catch {}

// --- Estados HTTP de interés ---
function isSuccessStatus(status: number) {
  return status === 200 || status === 201 || status === 202 || status === 204;
}
function isDuplicateSkip(status: number) {
  return status === 412; // If-None-Exist -> duplicado saltado (OK lógico)
}
function isRetryable(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// --- Tipos públicos ---
export type SyncOpts = {
  fhirBaseUrl: string;
  getToken: () => Promise<string | null>;
  backoff?: { retries?: number; minMs?: number; maxMs?: number };
};

type FlushResult = { processed: number; remaining: number };

// Guardado global para coalescer flushes concurrentes (evita carreras)
let _currentFlush: Promise<FlushResult> | null = null;

type PostBundleResult = Awaited<ReturnType<typeof postBundle>>;

// --- API principal: intenta enviar o encola si no hay red / error ---
export async function syncBundleOrEnqueue(
  bundle: any,
  opts: SyncOpts
): Promise<'sent' | 'queued'> {
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
    const token = await opts.getToken();
    if (!token) {
      logger.info('Sync: queueing bundle because there is no authenticated session', { idemKey });
      await enqueue(bundle, idemKey);
      return 'queued';
    }
    const resp = await sendWithRetry(bundle, idemKey, opts);
    if (resp.status === 401 || resp.status === 403) {
      logger.warn('Sync: enqueueing bundle after unauthorized response', {
        idemKey,
        status: resp.status,
      });
      await enqueue(bundle, idemKey);
      return 'queued';
    }
    return 'sent';
  } catch (error) {
    logger.warn('Sync: sending bundle failed, queued for later retry', {
      idemKey,
      error: error instanceof Error ? error.message : String(error),
    });
    await enqueue(bundle, idemKey);
    return 'queued';
  }
}

// --- Envío con backoff + marcas por intento ---
async function sendWithRetry(bundle: any, idemKey: string, opts: SyncOpts): Promise<PostBundleResult> {
  return await retryWithBackoff<PostBundleResult>(
    async (attempt) => {
      const token = await opts.getToken();
      if (!token) {
        logger.info('Sync: aborting HTTP send because session is not authenticated', { attempt, idemKey });
        return {
          ok: false,
          status: 401,
          body: { error: 'NOT_AUTHENTICATED' },
          issue: [
            { severity: 'error', code: 'login', diagnostics: 'NOT_AUTHENTICATED' },
          ],
          issues: [
            { severity: 'error', code: 'login', diagnostics: 'NOT_AUTHENTICATED' },
          ],
        } as PostBundleResult;
      }

      mark('sync.http.request', { attempt, idemKey });
      const resp = await postBundle(bundle, {
        headers: { 'Idempotency-Key': idemKey },
        token,
      });
      mark('sync.http.response', { status: resp.status, attempt });

      if (resp.status === 401 || resp.status === 403) {
        logger.warn('Sync: unauthorized response received during sendWithRetry', {
          attempt,
          status: resp.status,
          idemKey,
        });
        return resp;
      }

      if (isSuccessStatus(resp.status) || isDuplicateSkip(resp.status)) {
        return resp;
      }
      if (isRetryable(resp.status)) throw new Error(`Retryable ${resp.status}`);

      const body = resp.body ? JSON.stringify(resp.body) : '';
      throw new Error(`Non-retryable HTTP ${resp.status} ${body}`);
    },
    opts.backoff
  );
}

// --- Encolar cifrado + marca ---
async function enqueue(bundle: any, idemKey: string) {
  mark('sync.enqueue', { kind: 'FHIR_BUNDLE', idemKey });
  await enqueueTx({ payload: { bundle, meta: { hash: idemKey } } });
}

// --- Estado de red ---
async function hasInternet(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return !!(s.isConnected && (s.isInternetReachable ?? true));
}

/** Factoriza el flush para reuse (daemon + acción manual). */
function createFlusher(opts: SyncOpts) {
  configureFHIRClient({
    getBaseUrl: () => opts.fhirBaseUrl,
    ensureFreshToken: async () => (await opts.getToken()) ?? null,
  });

  return async function flushImpl(): Promise<FlushResult> {
    mark('sync.flush.start');
    const sessionToken = await opts.getToken();
    if (!sessionToken) {
      const remaining = (await readQueue()).length;
      logger.info('Sync: skipping queue flush because there is no authenticated session', {
        remaining,
      });
      return { processed: 0, remaining };
    }
    let processed = 0;

    await runQueueFlush(async (tx) => {
      const payload = tx.payload ?? {};
      const bundle = payload.bundle;
      const hash = payload.meta?.hash ?? tx.key;

      if (!bundle) {
        processed++;
        return { ok: true, status: 204 };
      }

      try {
        const resp = await sendWithRetry(bundle, hash, opts);
        if (resp.ok || isSuccessStatus(resp.status) || isDuplicateSkip(resp.status)) {
          processed++;
        }
        return { ok: resp.ok, status: resp.status };
      } catch (err: any) {
        mark('sync.flush.error', {
          reason: err?.message ?? String(err),
          tries: tx.tries,
          id: tx.key,
        });
        return { ok: false, status: 500 };
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
    return { processed, remaining };
  };
}

// Coalescer flushes concurrentes (misma instancia de módulo)
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
      // coalesce
      triggerFlush(opts).catch(() => {});
    }
  });

  // Intento inicial (por si ya hay red al iniciar la app)
  triggerFlush(opts).catch(() => {});
  return () => unsub();
}

/** === Permite forzar un flush desde la UI (Sync Center) === */
export async function flushQueueNow(opts: SyncOpts): Promise<FlushResult> {
  return triggerFlush(opts);
}

/** === Tamaño actual de la cola (para banner/UI) === */
export async function getQueueSize(): Promise<number> {
  try {
    const queue = await readQueue();
    return queue.length;
  } catch {
    return -1;
  }
}
