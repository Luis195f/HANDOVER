import * as SecureStore from 'expo-secure-store';
import { SENSITIVE_FIELDS, type SensitiveFieldPath } from '@/security/sensitiveFields';

export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export interface OfflineQueueItem {
  id: string;
  key: string;
  type: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  failedAt?: number;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
  /**
   * Clave opcional de idempotencia/deduplicación.
   * Si dos items tienen el mismo `type` y `dedupKey`, se considera
   * que representan la misma operación lógica.
   */
  dedupKey?: string;
  /** @deprecated usa `attempts` en su lugar */
  tries?: number;
}

export type OfflineQueue = OfflineQueueItem[];

export interface EnqueuePayload {
  type?: string;
  payload?: unknown;
  key?: string;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
  dedupKey?: string;
}

export type SendFn = (tx: OfflineQueueItem) => Promise<Response | { ok: boolean; status: number }>;

export const OFFLINE_QUEUE_KEY = 'handover_offline_queue_v1';

// Storage helpers
async function readStoredQueue(): Promise<OfflineQueue> {
  const raw = await SecureStore.getItemAsync(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredItem).filter(Boolean) as OfflineQueue;
  } catch {
    // si hay datos corruptos, empezamos desde cola vacía
    return [];
  }
}

async function writeStoredQueue(queue: OfflineQueue): Promise<void> {
  const raw = JSON.stringify(queue.map(syncCompatibilityFields));
  await SecureStore.setItemAsync(OFFLINE_QUEUE_KEY, raw);
}

async function clearStoredQueue(): Promise<void> {
  await SecureStore.deleteItemAsync(OFFLINE_QUEUE_KEY);
}

// Domain helpers
function generateId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function hasPath(payload: unknown, path: SensitiveFieldPath): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const segments = path.split('.');
  let current: unknown = payload;

  for (const segment of segments) {
    if (current == null || (typeof current !== 'object' && !Array.isArray(current))) return false;
    if (!(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }

  return current !== undefined;
}

function findSensitiveFields(payload: unknown): SensitiveFieldPath[] {
  if (payload == null || typeof payload !== 'object') return [];
  return SENSITIVE_FIELDS.filter((field) => hasPath(payload, field));
}

function hasPendingDuplicate(queue: OfflineQueue, input: EnqueuePayload): boolean {
  if (!input.dedupKey) return false;

  return queue.some(
    (item) => item.type === (input.type ?? 'generic') && item.dedupKey === input.dedupKey && !item.failedAt
  );
}

function createQueueItem(input: EnqueuePayload): OfflineQueueItem {
  const id = input.key ?? generateId();
  const type = input.type ?? 'generic';
  const createdAt = Date.now();
  const attempts = 0;
  const sensitiveFields =
    input.sensitiveFields ?? (input.payload ? findSensitiveFields(input.payload) : []);

  return {
    id,
    key: id,
    type,
    payload: input.payload ?? null,
    createdAt,
    attempts,
    tries: attempts,
    lastAttemptAt: undefined,
    failedAt: undefined,
    hash: input.hash,
    sensitiveFields: sensitiveFields.length > 0 ? sensitiveFields : undefined,
    dedupKey: input.dedupKey,
  };
}

function normalizeStoredItem(raw: unknown): OfflineQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<OfflineQueueItem> & Record<string, unknown>;

  const attempts =
    typeof item.attempts === 'number'
      ? item.attempts
      : typeof item.tries === 'number'
      ? item.tries
      : 0;

  const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
  const id = typeof item.id === 'string' ? item.id : typeof item.key === 'string' ? item.key : generateId();
  const key = typeof item.key === 'string' ? item.key : id;
  const type = typeof item.type === 'string' ? item.type : 'generic';

  const normalized: OfflineQueueItem = {
    id,
    key,
    type,
    payload: item.payload,
    createdAt,
    attempts,
    tries: attempts,
    lastAttemptAt: typeof item.lastAttemptAt === 'number' ? item.lastAttemptAt : undefined,
    failedAt: typeof item.failedAt === 'number' ? item.failedAt : undefined,
    hash: typeof item.hash === 'string' ? item.hash : undefined,
    sensitiveFields: Array.isArray(item.sensitiveFields)
      ? (item.sensitiveFields as SensitiveFieldPath[])
      : undefined,
    dedupKey: typeof item.dedupKey === 'string' ? item.dedupKey : undefined,
  };

  return normalized;
}

function syncCompatibilityFields(item: OfflineQueueItem): OfflineQueueItem {
  return { ...item, tries: item.attempts };
}

type SyncErrorType = 'network' | 'server' | 'client' | 'unknown';

interface SyncErrorInfo {
  type: SyncErrorType;
  status?: number;
  message?: string;
}

function isSuccessfulResponse(res: Response | { ok: boolean; status: number }): boolean {
  const status = 'status' in res ? res.status : (res as Response)?.status;
  const okFlag = 'ok' in res ? res.ok : (res as Response)?.ok;

  return okFlag === true || status === 200 || status === 201 || status === 412;
}

function getStatus(res: Response | { ok: boolean; status: number }): number {
  if ('status' in res && typeof res.status === 'number') return res.status;
  if (res instanceof Response) return res.status;
  return 0;
}

async function performSync(item: OfflineQueueItem, sender: SendFn): Promise<SyncErrorInfo | null> {
  try {
    const res = await sender(item);

    if (isSuccessfulResponse(res)) {
      return null;
    }

    const status = getStatus(res);
    const type: SyncErrorType = status >= 500 ? 'server' : status >= 400 ? 'client' : 'unknown';
    const message = res instanceof Response ? res.statusText : undefined;

    return { status, message, type };
  } catch (e: any) {
    return {
      type: 'network',
      message: e?.message ?? 'Network error',
    };
  }
}

export function shouldAttemptNow(item: OfflineQueueItem, now = Date.now()): boolean {
  if (item.failedAt) {
    return false;
  }

  if (item.attempts >= MAX_ATTEMPTS) {
    return false;
  }

  if (!item.lastAttemptAt) {
    return true;
  }

  const delayIndex = Math.min(item.attempts, RETRY_DELAYS_MS.length - 1);
  const requiredDelay = RETRY_DELAYS_MS[delayIndex];
  const elapsed = now - item.lastAttemptAt;

  return elapsed >= requiredDelay;
}

// Public API
export async function enqueueTx(input: EnqueuePayload): Promise<OfflineQueueItem> {
  const queue = await readStoredQueue();

  if (hasPendingDuplicate(queue, input)) {
    const duplicate = queue.find(
      (entry) => entry.type === (input.type ?? 'generic') && entry.dedupKey === input.dedupKey && !entry.failedAt
    );
    return duplicate ?? createQueueItem(input);
  }

  const item = createQueueItem(input);
  const existingIndex = queue.findIndex((entry) => entry.key === item.key);
  if (existingIndex >= 0) {
    queue[existingIndex] = item;
  } else {
    queue.push(item);
  }

  await writeStoredQueue(queue);
  return item;
}

export async function readQueue(): Promise<OfflineQueue> {
  const queue = await readStoredQueue();
  return [...queue].sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeItem(key: string): Promise<void> {
  const queue = await readStoredQueue();
  const next = queue.filter((item) => item.key !== key);
  if (next.length === 0) {
    await clearStoredQueue();
    return;
  }
  if (next.length !== queue.length) {
    await writeStoredQueue(next);
  }
}

export async function clearAll(): Promise<void> {
  await clearStoredQueue();
}

export async function flushQueue(sender: SendFn): Promise<void> {
  let queue = await readStoredQueue();
  queue = [...queue].sort((a, b) => a.createdAt - b.createdAt);

  let mutated = false;

  for (const item of [...queue]) {
    const index = queue.findIndex((entry) => entry.key === item.key);
    if (index < 0) continue;
    const current = queue[index];

    if (!shouldAttemptNow(current)) {
      continue;
    }

    const error = await performSync(current, sender);
    if (!error) {
      queue = queue.filter((entry) => entry.key !== current.key);
      mutated = true;
      continue;
    }

    const now = Date.now();
    const attempts = (current.attempts ?? current.tries ?? 0) + 1;
    const isFinalClientError = error.type === 'client';
    const failedAt = isFinalClientError || attempts >= MAX_ATTEMPTS ? now : current.failedAt;
    const updated: OfflineQueueItem = {
      ...current,
      attempts,
      tries: attempts,
      lastAttemptAt: now,
      failedAt,
    };
    queue[index] = updated;
    mutated = true;
  }

  if (!mutated) return;

  if (queue.length === 0) {
    await clearStoredQueue();
  } else {
    await writeStoredQueue(queue);
  }
}
