import * as SecureStore from 'expo-secure-store';
import { SENSITIVE_FIELDS, type SensitiveFieldPath } from '@/security/sensitiveFields';

export interface OfflineQueueItem {
  id: string;
  key: string;
  type: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
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
    hash: input.hash,
    sensitiveFields: sensitiveFields.length > 0 ? sensitiveFields : undefined,
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
    lastAttemptAt: item.lastAttemptAt,
    hash: typeof item.hash === 'string' ? item.hash : undefined,
    sensitiveFields: Array.isArray(item.sensitiveFields)
      ? (item.sensitiveFields as SensitiveFieldPath[])
      : undefined,
  };

  return normalized;
}

function syncCompatibilityFields(item: OfflineQueueItem): OfflineQueueItem {
  return { ...item, tries: item.attempts };
}

// Public API
export async function enqueueTx(input: EnqueuePayload): Promise<OfflineQueueItem> {
  const item = createQueueItem(input);

  const queue = await readStoredQueue();
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

  for (const item of [...queue]) {
    const attempts = (item.attempts ?? item.tries ?? 0) + 1;
    const updated: OfflineQueueItem = {
      ...item,
      attempts,
      tries: attempts,
      lastAttemptAt: Date.now(),
    };
    const index = queue.findIndex((entry) => entry.key === item.key);
    if (index >= 0) {
      queue[index] = updated;
      await writeStoredQueue(queue);
    }

    const res = await sender(updated);
    const status = 'status' in res ? res.status : (res as Response)?.status;
    if (res.ok || status === 201 || status === 200 || status === 412) {
      queue = queue.filter((entry) => entry.key !== item.key);
      if (queue.length === 0) {
        await clearStoredQueue();
      } else {
        await writeStoredQueue(queue);
      }
    } else {
      break;
    }
  }
}
