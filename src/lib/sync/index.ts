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
import { FhirClient } from '../fhir-client';
import { retryWithBackoff } from './backoff';
import { bundleIdempotencyKey } from './ident';
import {
  enqueueBundleEncrypted,
  peekNext,
  bumpTries,
  markDone,
  size as queueSize,
} from '../offlineQueue';

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

// --- API principal: intenta enviar o encola si no hay red / error ---
export async function syncBundleOrEnqueue(
  bundle: any,
  opts: SyncOpts
): Promise<'sent' | 'queued'> {
  const online = await hasInternet();
  const idemKey = bundleIdempotencyKey(bundle);
  const client = new FhirClient({
    baseUrl: opts.fhirBaseUrl,
    getToken: opts.getToken,
    timeoutMs: 15000,
  });

  if (!online) {
    await enqueue(bundle, idemKey);
    return 'queued';
  }

  try {
    await sendWithRetry(client, bundle, idemKey, opts);
    return 'sent';
  } catch {
    await enqueue(bundle, idemKey);
    return 'queued';
  }
}

// --- Envío con backoff + marcas por intento ---
async function sendWithRetry(
  client: FhirClient,
  bundle: any,
  idemKey: string,
  opts: SyncOpts
) {
  await retryWithBackoff(
    async (attempt) => {
      mark('sync.http.request', { attempt, idemKey });
      const resp = await client.postBundle(bundle, idemKey);
      mark('sync.http.response', { status: resp.status, attempt });

      if (isSuccessStatus(resp.status) || isDuplicateSkip(resp.status)) return;
      if (isRetryable(resp.status)) throw new Error(`Retryable ${resp.status}`);

      const body = await resp.text().catch(() => '');
      throw new Error(`Non-retryable HTTP ${resp.status} ${body}`);
    },
    opts.backoff
  );
}

// --- Encolar cifrado + marca ---
async function enqueue(bundle: any, idemKey: string) {
  mark('sync.enqueue', { kind: 'FHIR_BUNDLE', idemKey });
  await enqueueBundleEncrypted(bundle, idemKey);
}

// --- Estado de red ---
async function hasInternet(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return !!(s.isConnected && (s.isInternetReachable ?? true));
}

/** Factoriza el flush para reuse (daemon + acción manual). */
function createFlusher(opts: SyncOpts) {
  const client = new FhirClient({
    baseUrl: opts.fhirBaseUrl,
    getToken: opts.getToken,
    timeoutMs: 15000,
  });

  return async function flushImpl(): Promise<FlushResult> {
    mark('sync.flush.start');
    let processed = 0;

    let next = await peekNext();
    while (next) {
      const { meta, bundle } = next;
      try {
        await sendWithRetry(client, bundle, meta.hash, opts);
        await markDone(meta.id);
        processed++;
      } catch (err: any) {
        mark('sync.flush.error', {
          reason: err?.message ?? String(err),
          tries: meta.tries,
          id: meta.id,
        });
        await bumpTries(meta.id);
        break; // corta; reintentará en el próximo evento de red
      }
      next = await peekNext();
    }

    const remaining = await queueSize().catch(() => -1);
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
  const unsub = NetInfo.addEventListener((state) => {
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
    return await queueSize();
  } catch {
    return -1;
  }
}
