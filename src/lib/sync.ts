// @ts-nocheck
// src/lib/sync.ts
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  buildHandoverBundle,
  mapObservationVitals,
  type BuildOptions,
  type HandoverInput,
  type HandoverValues,
} from './fhir-map';
import {
  postBundleSmart,
  postBundle,
  type Bundle,
  type OperationIssue,
  type ResponseLike,
} from './fhir-client';
import { z } from 'zod';

export type LegacyQueueItem = {
  patientId: string;
  bundle: { resourceType: 'Bundle'; type: 'transaction'; entry?: any[] };
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  values?: HandoverValues;
  authorId?: string;
};

export type SenderResult = Response | { ok: boolean; status: number };

export type SendFn = (tx: LegacyQueueItem) => Promise<SenderResult>;

export type FlushCompatOptions = {
  sender?: SendFn;
  /**
   * Si se indica, intenta limpiar el borrador de este patientId cuando
   * el envío del Bundle termine en 201 Created / 200 OK o 409/412 Already exists.
   */
  onSent?: (input: { patientId: string }) => Promise<void> | void;
  /**
   * Pausa entre elementos, por si el backend prefiere no recibir ráfagas.
   */
  delayMs?: number;
};

/**
 * Utilidades simples para SecureStore:
 * - en Android usa un fallback sin encriptar si hace falta (dev/test)
 * - en iOS usa por defecto el almacenamiento seguro
 */
async function safeSetItemAsync(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch (e) {
    if (Platform.OS === 'android') {
      // En Android en modo dev algunas builds tiran con fallback
      (globalThis as any).__insecureKV ??= new Map<string, string>();
      (globalThis as any).__insecureKV.set(key, value);
      return;
    }
    throw e;
  }
}

async function safeGetItemAsync(key: string) {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v != null) return v;
  } catch (e) {
    if (Platform.OS !== 'android') throw e;
  }
  if (Platform.OS === 'android') {
    const map: Map<string, string> | undefined = (globalThis as any).__insecureKV;
    return map?.get(key) ?? null;
  }
  return null;
}

const SECURE_QUEUE_KEY = 'handover.queue.v1';
const DEAD_QUEUE_KEY = 'handover.queue.dead.v1';
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const JITTER_RATIO = 0.25;
const GROUP_WINDOW_MS = 10 * 60 * 1000;

export type QueueItem = {
  id: string;
  patientId?: string;
  fullUrls: string[];
  bundle: Bundle;
  attempts: number;
  nextAt: number;
  windowStart: number;
  enqueuedAt: number;
  lastError?: string;
};

type StoredQueueItem = {
  id?: unknown;
  patientId?: unknown;
  fullUrls?: unknown;
  bundle?: unknown;
  attempts?: unknown;
  nextAt?: unknown;
  windowStart?: unknown;
  enqueuedAt?: unknown;
  lastError?: unknown;
};

type DeadQueueItem = QueueItem & {
  failedAt: number;
  status?: number;
  issue?: OperationIssue[];
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ensureBundleShape(bundle: unknown): Bundle {
  if (!isRecord(bundle) || bundle.resourceType !== 'Bundle') {
    throw new Error('Queue expects FHIR Bundle');
  }
  const entries = Array.isArray(bundle.entry)
    ? bundle.entry.filter((entry): entry is NonNullable<Bundle['entry']>[number] => !!entry)
    : [];
  return {
    ...(bundle as Bundle),
    resourceType: 'Bundle',
    entry: entries,
  };
}

function normalizeFullUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url) => url);
}

function normalizeQueueItem(value: StoredQueueItem): QueueItem {
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Queue item requires id');
  }

  const attempts = typeof value.attempts === 'number' && Number.isFinite(value.attempts) && value.attempts >= 0
    ? Math.floor(value.attempts)
    : 0;
  const nextAt = typeof value.nextAt === 'number' && Number.isFinite(value.nextAt) ? value.nextAt : Date.now();
  const windowStart = typeof value.windowStart === 'number' && Number.isFinite(value.windowStart)
    ? value.windowStart
    : computeWindowStart(nextAt);
  const enqueuedAt = typeof value.enqueuedAt === 'number' && Number.isFinite(value.enqueuedAt)
    ? value.enqueuedAt
    : Date.now();

  return {
    id: value.id,
    patientId: typeof value.patientId === 'string' && value.patientId.length > 0 ? value.patientId : undefined,
    fullUrls: normalizeFullUrls(value.fullUrls),
    bundle: ensureBundleShape(value.bundle),
    attempts,
    nextAt,
    windowStart,
    enqueuedAt,
    lastError: typeof value.lastError === 'string' && value.lastError.length > 0 ? value.lastError : undefined,
  };
}

async function readSecureQueue(): Promise<QueueItem[]> {
  const raw = await safeGetItemAsync(SECURE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredQueueItem => isRecord(item) && typeof item.id === 'string')
      .map((item) => normalizeQueueItem(item));
  } catch {
    return [];
  }
}

async function writeSecureQueue(items: QueueItem[]): Promise<void> {
  const payload = items.map((item) => ({ ...item }));
  await safeSetItemAsync(SECURE_QUEUE_KEY, JSON.stringify(payload));
}

async function pushDeadEntry(item: QueueItem, context?: { response?: ResponseLike; error?: string }) {
  const raw = await safeGetItemAsync(DEAD_QUEUE_KEY);
  let existing: DeadQueueItem[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        existing = parsed
          .filter((value): value is DeadQueueItem => isRecord(value) && typeof value.failedAt === 'number')
          .map((value) => ({
            ...normalizeQueueItem(value as StoredQueueItem),
            failedAt: typeof value.failedAt === 'number' ? value.failedAt : Date.now(),
            status: typeof value.status === 'number' ? value.status : undefined,
            issue: Array.isArray(value.issue) ? (value.issue as OperationIssue[]) : undefined,
            error: typeof value.error === 'string' ? value.error : undefined,
          }));
      }
    } catch {
      existing = [];
    }
  }

  const entry: DeadQueueItem = {
    ...item,
    failedAt: Date.now(),
    status: context?.response?.status,
    issue: context?.response?.issue,
    error: context?.error ?? context?.response?.issue?.[0]?.diagnostics,
  };

  existing.push(entry);
  if (existing.length > 50) {
    existing = existing.slice(existing.length - 50);
  }
  await safeSetItemAsync(DEAD_QUEUE_KEY, JSON.stringify(existing));
}

function jitter(ms: number): number {
  const spread = ms * JITTER_RATIO;
  const delta = (Math.random() * 2 - 1) * spread;
  return Math.max(0, Math.round(ms + delta));
}

function backoff(attempt: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  return Math.min(BACKOFF_MAX_MS, exp);
}

function computeWindowStart(timestamp: number): number {
  const window = Math.floor(timestamp / GROUP_WINDOW_MS) * GROUP_WINDOW_MS;
  return window;
}

function computeId(fullUrls: string[]): string {
  if (fullUrls.length === 0) return 'empty';
  const base = fullUrls.slice().sort().join('|');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require('crypto') as typeof import('crypto');
    return createHash('sha1').update(base).digest('hex');
  } catch {
    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
      hash = (hash << 5) - hash + base.charCodeAt(i);
      hash |= 0;
    }
    return `h${(hash >>> 0).toString(16)}`;
  }
}

function collectFullUrls(bundle: Bundle): string[] {
  if (!Array.isArray(bundle.entry)) return [];
  return bundle.entry
    .map((entry) => (typeof entry?.fullUrl === 'string' ? entry.fullUrl : undefined))
    .filter((url): url is string => !!url);
}

function samePatientWindow(a: QueueItem, b: QueueItem): boolean {
  const keyA = a.patientId ?? a.id;
  const keyB = b.patientId ?? b.id;
  if (keyA !== keyB) return false;
  return Math.abs(a.windowStart - b.windowStart) <= GROUP_WINDOW_MS;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function enqueue(bundle: Bundle, opts?: { patientId?: string }): Promise<void> {
  const normalized = ensureBundleShape(bundle);
  const fullUrls = collectFullUrls(normalized);
  const id = computeId(fullUrls);
  const now = Date.now();
  const windowStart = computeWindowStart(now);
  const queue = await readSecureQueue();

  if (queue.some((item) => item.id === id)) {
    return;
  }

  const patientId = opts?.patientId ?? extractPatientIdFromBundle(normalized);
  if (patientId) {
    const idx = queue.findIndex(
      (item) => item.patientId === patientId && Math.abs(item.windowStart - windowStart) <= GROUP_WINDOW_MS,
    );
    if (idx >= 0) {
      queue[idx] = {
        ...queue[idx],
        id,
        bundle: normalized,
        fullUrls,
        attempts: 0,
        nextAt: Math.min(queue[idx].nextAt, now),
        windowStart,
        enqueuedAt: now,
        lastError: undefined,
      };
      await writeSecureQueue(queue);
      return;
    }
  }

  queue.push({
    id,
    patientId: patientId ?? undefined,
    fullUrls,
    bundle: normalized,
    attempts: 0,
    nextAt: now,
    windowStart,
    enqueuedAt: now,
    lastError: undefined,
  });

  await writeSecureQueue(queue);
}

let drainingSecureQueue = false;

export async function drain(getToken: () => Promise<string>): Promise<void> {
  if (drainingSecureQueue) return;
  drainingSecureQueue = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let queue = await readSecureQueue();
      if (queue.length === 0) break;

      queue = queue.slice().sort((a, b) => a.nextAt - b.nextAt);
      const now = Date.now();
      const ready = queue.filter((item) => item.nextAt <= now);
      if (!ready.length) break;

      const head = ready[0];
      const cohort = ready.filter((item) => samePatientWindow(item, head));

      for (const item of cohort) {
        const freshQueue = await readSecureQueue();
        const index = freshQueue.findIndex((entry) => entry.id === item.id);
        if (index < 0) continue;
        const current = freshQueue[index];
        if (current.nextAt > Date.now()) continue;

        let response: ResponseLike | undefined;
        try {
          const token = await getToken();
          if (!token) throw new Error('OAuth token is required');
          response = await postBundle(current.bundle, { token });
        } catch (error) {
          const attempts = current.attempts + 1;
          const delay = jitter(backoff(attempts));
          freshQueue[index] = {
            ...current,
            attempts,
            nextAt: Date.now() + delay,
            lastError: error instanceof Error ? error.message : String(error),
          };
          await writeSecureQueue(freshQueue);
          continue;
        }

        if (response.ok) {
          freshQueue.splice(index, 1);
          await writeSecureQueue(freshQueue);
          continue;
        }

        if (shouldRetryStatus(response.status)) {
          const attempts = current.attempts + 1;
          const delay = jitter(backoff(attempts));
          freshQueue[index] = {
            ...current,
            attempts,
            nextAt: Date.now() + delay,
            lastError: response.issue?.[0]?.diagnostics ?? `HTTP ${response.status}`,
          };
          await writeSecureQueue(freshQueue);
          continue;
        }

        const [removed] = freshQueue.splice(index, 1);
        await writeSecureQueue(freshQueue);
        await pushDeadEntry(removed, { response });
      }
    }
  } finally {
    drainingSecureQueue = false;
  }
}

function sleep(ms?: number) {
  return new Promise((r) => setTimeout(r, ms ?? 0));
}

const QUEUE_KEY = '@handover/tx-queue';
const PATIENT_IDENTIFIER_SYSTEM = 'urn:handover-pro:ids';
const OBS_IDENTIFIER_SYSTEM = 'urn:handover-pro:obs';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeNextAttempt(attempts: number, now = Date.now()) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
  return new Date(now + exp + jitter).toISOString();
}

function ensureTransactionBundle(
  bundle: any,
): { resourceType: 'Bundle'; type: 'transaction'; entry?: any[] } {
  if (!bundle || typeof bundle !== 'object') {
    return { resourceType: 'Bundle', type: 'transaction', entry: [] };
  }
  const normalized: any = Array.isArray(bundle.entry)
    ? { ...bundle, resourceType: 'Bundle', type: 'transaction', entry: bundle.entry }
    : { ...bundle, resourceType: 'Bundle', type: 'transaction', entry: [] };
  normalized.resourceType = 'Bundle';
  normalized.type = 'transaction';
  if (!Array.isArray(normalized.entry)) {
    normalized.entry = [];
  }
  return normalized;
}

function migrateLegacyQueueItem(raw: any): LegacyQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;

  if ('patientId' in raw && 'bundle' in raw) {
    const patientId = typeof raw.patientId === 'string' ? raw.patientId : 'unknown';
    const attempts = asNumber(raw.attempts, 0);
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
    const nextAttemptAt =
      typeof raw.nextAttemptAt === 'string' ? raw.nextAttemptAt : new Date().toISOString();
    return {
      patientId,
      bundle: ensureTransactionBundle(raw.bundle),
      attempts: attempts >= 0 ? attempts : 0,
      nextAttemptAt,
      createdAt,
      updatedAt,
      values: raw.values,
      authorId: raw.authorId,
    };
  }

  if ('payload' in raw && typeof raw.payload === 'object' && raw.payload) {
    const payload = raw.payload as any;
    const patientId = typeof payload.patientId === 'string' ? payload.patientId : 'unknown';
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    return {
      patientId,
      bundle: ensureTransactionBundle(payload.bundle),
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      createdAt,
      updatedAt: createdAt,
      values: payload.values,
      authorId: payload.authorId,
    };
  }

  return null;
}

async function loadQueue(): Promise<LegacyQueueItem[]> {
  const s = await safeGetItemAsync(QUEUE_KEY);
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    const migrated = arr
      .map((raw) => migrateLegacyQueueItem(raw))
      .filter((it): it is LegacyQueueItem => !!it);
    return migrated;
  } catch {
    return [];
  }
}

async function saveQueue(items: LegacyQueueItem[]) {
  await safeSetItemAsync(QUEUE_KEY, JSON.stringify(items));
}

/**
 * Encola un bundle ya construido (útil para reintentos fuera del form)
 */
type EnqueueBundleInput = {
  patientId: string;
  bundle: any;
  values?: HandoverValues;
  authorId?: string;
};

function isRawBundleInput(value: unknown): value is { resourceType?: string; entry?: any[] } {
  return !!value && typeof value === 'object' && (value as any).resourceType === 'Bundle';
}

function extractPatientIdFromBundle(bundle: { entry?: any[] }): string | undefined {
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Patient') continue;

    const identifiers = Array.isArray(resource?.identifier) ? resource.identifier : [];
    for (const identifier of identifiers) {
      if (
        identifier &&
        typeof identifier === 'object' &&
        identifier.system === PATIENT_IDENTIFIER_SYSTEM &&
        typeof identifier.value === 'string'
      ) {
        return identifier.value;
      }
    }

    if (typeof resource?.id === 'string' && resource.id.length > 0) {
      return resource.id;
    }

    if (typeof entry?.fullUrl === 'string' && entry.fullUrl.startsWith('urn:uuid:patient-')) {
      return entry.fullUrl.replace('urn:uuid:patient-', '');
    }
  }
  return undefined;
}

export async function enqueueBundle(input: EnqueueBundleInput | { resourceType: string; entry?: any[] }) {
  const normalized: EnqueueBundleInput = isRawBundleInput(input)
    ? {
        patientId: extractPatientIdFromBundle(input) ?? 'unknown',
        bundle: input,
      }
    : input;

  const patientId = normalized.patientId ?? 'unknown';
  const nowIso = new Date().toISOString();
  const queue = await loadQueue();
  const bundle = ensureTransactionBundle(normalized.bundle);

  const existingIndex = queue.findIndex((it) => it.patientId === patientId);
  const updated: LegacyQueueItem = {
    patientId,
    bundle,
    attempts: 0,
    nextAttemptAt: nowIso,
    createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : nowIso,
    updatedAt: nowIso,
    values: normalized.values,
    authorId: normalized.authorId,
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = updated;
  } else {
    queue.push(updated);
  }

  await saveQueue(queue);
  return updated;
}

/**
 * Retorna el tamaño actual de la cola offline.
 * Usamos el origen real de la cola (loadQueue) para no acoplar a detalles internos.
 */
export async function getQueueSize(): Promise<number> {
  const [legacy, secure] = await Promise.all([loadQueue(), readSecureQueue()]);
  return legacy.length + secure.length;
}

// Alias de compatibilidad: algunos sitios importan flushQueueNow.
export const flushQueueNow = flushQueue;

/**
 * Crea y encola un Bundle de handover a partir de los valores del formulario.
 * Si falla la construcción/validación, lanza ZodError.
 */
export async function enqueueTxFromValues(
  values: HandoverValues,
  opts?: BuildOptions & { authorId?: string }
) {
  const patientId = values.patientId ?? 'unknown';
  const bundle = buildHandoverBundle(values as unknown as HandoverInput, {
    now: opts?.now,
    normalizeGlucoseToMgdl: opts?.normalizeGlucoseToMgdl,
    glucoseDecimals: opts?.glucoseDecimals,
    emitPanel: opts?.emitPanel,
    emitHasMember: opts?.emitHasMember,
    emitBpPanel: opts?.emitBpPanel,
    profileUrls: opts?.profileUrls,
    // cualquier otra opción que tengas añadida al tipo BuildOptions
  });

  return enqueueBundle({
    patientId,
    bundle,
    values,
    authorId: opts?.authorId,
  });
}

/**
 * Envía la cola con un "sender" (por defecto usa postBundleSmart)
 * - 201/200: éxito → elimina el elemento
 * - 409/412: conflicto (ya existe) → considera entregado y elimina el elemento
 * - Otros: deja el elemento para reintento y sigue con el siguiente
 */
export async function flushQueue(opts?: FlushCompatOptions) {
  const sender: SendFn =
    opts?.sender ??
    (async (tx) => {
      const { bundle } = tx;
      return postBundleSmart(bundle);
    });

  const initialQueue = await loadQueue();
  if (initialQueue.length === 0) {
    return { total: 0, sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let queue = initialQueue;

  const sorted = queue
    .slice()
    .sort(
      (a, b) => new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime(),
    );

  for (const candidate of sorted) {
    const now = Date.now();
    queue = await loadQueue();
    const current = queue.find((it) => it.patientId === candidate.patientId);
    if (!current) continue;

    if (new Date(current.nextAttemptAt).getTime() > now) {
      continue;
    }

    try {
      const res = await sender(current);
      const status =
        typeof (res as any)?.status === 'number'
          ? (res as any).status
          : res instanceof Response
            ? res.status
            : 0;
      const ok =
        (res as any)?.ok === true ||
        (res instanceof Response ? res.ok : status >= 200 && status < 300);

      if (ok || status === 200 || status === 201 || status === 409 || status === 412) {
        queue = queue.filter((it) => it.patientId !== current.patientId);
        await saveQueue(queue);
        sent++;
        await opts?.onSent?.({ patientId: current.patientId });
      } else {
        const attempts = (current.attempts ?? 0) + 1;
        const nextAttemptAt = computeNextAttempt(attempts);
        const updated: LegacyQueueItem = {
          ...current,
          attempts,
          nextAttemptAt,
          updatedAt: new Date().toISOString(),
        };
        queue = queue.map((it) => (it.patientId === current.patientId ? updated : it));
        await saveQueue(queue);
      }
    } catch {
      const attempts = (current.attempts ?? 0) + 1;
      const nextAttemptAt = computeNextAttempt(attempts);
      const updated: LegacyQueueItem = {
        ...current,
        attempts,
        nextAttemptAt,
        updatedAt: new Date().toISOString(),
      };
      queue = queue.map((it) => (it.patientId === current.patientId ? updated : it));
      await saveQueue(queue);
    }

    if (opts?.delayMs && opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  return { total: initialQueue.length, sent, skipped };
}

/**
 * Compatibilidad con tests: función "flush" que delega en flushQueue.
 */
export async function flush(
  sender?: SendFn | FlushCompatOptions,
  clearDraft?: ((patientId: string) => Promise<void> | void) | { baseDelayMs?: number },
  legacyOptions?: { baseDelayMs?: number },
) {
  if (typeof sender === 'object' && sender !== null && !('length' in sender)) {
    return flushQueue(sender as FlushCompatOptions);
  }

  const actualSender = typeof sender === 'function' ? sender : undefined;

  let onSent: FlushCompatOptions['onSent'] | undefined;
  let delayMs: number | undefined;

  if (typeof clearDraft === 'function') {
    onSent = async ({ patientId }) => {
      await clearDraft(patientId);
    };
  } else if (clearDraft && typeof clearDraft === 'object') {
    delayMs = clearDraft.baseDelayMs;
  }

  if (legacyOptions && typeof legacyOptions.baseDelayMs === 'number') {
    delayMs = legacyOptions.baseDelayMs;
  }

  return flushQueue({ sender: actualSender, onSent, delayMs });
}

/**
 * Construye un Bundle type=transaction con entradas binarias + conditional create
 * para Observations/Patient, según lo que hay encolado.
 * (Útil para suites de test que quieran inspeccionar la forma del bundle
 * que termina llegando al sender.)
 */
export function buildTransactionBundleForQueue(
  input: HandoverInput | HandoverValues,
  opts: BuildOptions = {},
) {
  const isWrapped = typeof input === 'object' && input !== null && 'values' in (input as HandoverInput);
  if (isWrapped) {
    const maybeValues = (input as HandoverInput).values;
    if (!maybeValues || typeof maybeValues.patientId !== 'string' || maybeValues.patientId.length === 0) {
      throw new Error('patientId required');
    }
  } else if (!('patientId' in (input as HandoverValues)) || !(input as HandoverValues).patientId) {
    throw new Error('patientId required');
  }
  const values: HandoverValues = isWrapped ? (input as HandoverInput).values : (input as HandoverValues);

  const patientIdRaw = values.patientId;
  const patientId = patientIdRaw ?? 'unknown';
  if (!patientIdRaw) {
    return { resourceType: 'Bundle', type: 'transaction', entry: [] };
  }

  const rawNow = opts.now ?? new Date();
  const resolvedNow = typeof rawNow === 'function' ? rawNow() : rawNow;
  const nowIso = typeof resolvedNow === 'string' ? resolvedNow : resolvedNow.toISOString();
  const patientFullUrl = `urn:uuid:patient-${patientId}`;
  const baseDate = (typeof resolvedNow === 'string' ? resolvedNow : resolvedNow.toISOString()).slice(0, 10);

  const observationOptions: BuildOptions = {
    now: resolvedNow,
    emitIndividuals: opts.emitIndividuals,
    normalizeGlucoseToMgDl: opts.normalizeGlucoseToMgDl,
    normalizeGlucoseToMgdl: opts.normalizeGlucoseToMgdl,
    glucoseDecimals: opts.glucoseDecimals,
  };

  const observations = mapObservationVitals(values, observationOptions);

  const entries: Array<{
    fullUrl: string;
    resource: any;
    request: { method: string; url: string; ifNoneExist?: string };
  }> = [];

  entries.push({
    fullUrl: patientFullUrl,
    resource: {
      resourceType: 'Patient',
      identifier: [{ system: PATIENT_IDENTIFIER_SYSTEM, value: patientId }],
    },
    request: {
      method: 'POST',
      url: 'Patient',
      ifNoneExist: `identifier=${encodeURIComponent(PATIENT_IDENTIFIER_SYSTEM)}|${encodeURIComponent(patientId)}`,
    },
  });

  observations.forEach((obs, index) => {
    const cloned = JSON.parse(JSON.stringify(obs ?? {}));
    cloned.subject = { reference: patientFullUrl };

    const loinc = Array.isArray(cloned?.code?.coding)
      ? cloned.code.coding.find((c: any) => c?.system === 'http://loinc.org')?.code
      : undefined;

    const effective = typeof cloned.effectiveDateTime === 'string' && cloned.effectiveDateTime.length
      ? cloned.effectiveDateTime
      : nowIso;
    const effectiveDate = effective.slice(0, 10) || baseDate;

    const identifierParts = [loinc, effectiveDate, patientId].filter(Boolean);
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      const existing = Array.isArray(cloned.identifier) ? cloned.identifier : [];
      cloned.identifier = [
        ...existing.filter((it: any) => it && typeof it === 'object'),
        { system: OBS_IDENTIFIER_SYSTEM, value: identifierValue },
      ];
    }

    const ifNoneParts: string[] = [];
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      ifNoneParts.push(
        `identifier=${encodeURIComponent(OBS_IDENTIFIER_SYSTEM)}|${encodeURIComponent(identifierValue)}`,
      );
    }

    ifNoneParts.push(`patient=${encodeURIComponent(patientFullUrl)}`);

    if (loinc) {
      ifNoneParts.push(`code=${encodeURIComponent('http://loinc.org')}|${encodeURIComponent(loinc)}`);
    }

    ifNoneParts.push(`effective=eq${effectiveDate}`);

    const fullUrl = `urn:uuid:obs-${loinc ?? 'custom'}-${patientId}-${effectiveDate}-${index}`;

    entries.push({
      fullUrl,
      resource: cloned,
      request: {
        method: 'POST',
        url: 'Observation',
        ifNoneExist: ifNoneParts.join('&'),
      },
    });
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

/**
 * Devuelve el estado actual de la cola (para debug / UI).
 */
export async function readQueueState() {
  const items = await loadQueue();
  return {
    size: items.length,
    items,
  };
}

/**
 * Borra por completo la cola (utilidad de depuración)
 */
export async function clearQueue() {
  await saveQueue([]);
}

/**
 * Encola desde un HandoverInput minimal, usado en pruebas de integración o
 * cuando ya tienes los valores sueltos (no desde el form).
 */
export async function enqueueTx(
  input: HandoverInput | HandoverValues,
  opts?: BuildOptions & { authorId?: string },
) {
  if (input && typeof input === 'object' && 'values' in (input as HandoverInput)) {
    return enqueueTxFromValues((input as HandoverInput).values, opts);
  }
  if (typeof input !== 'object' || input === null || !('patientId' in input) || !(input as any).patientId) {
    throw new Error('patientId required');
  }
  const values: HandoverValues = input as any;
  return enqueueTxFromValues(values, opts);
}

/**
 * Validación rápida (útil en tests) para asegurar que el input del handover
 * al menos tiene patientId o patient.id
 */
export function validateHandoverInput(input: unknown) {
  const S = z
    .object({
      patientId: z.string().optional(),
      patient: z.object({ id: z.string().optional() }).optional(),
    })
    .strict();
  return S.parse(input);
}

