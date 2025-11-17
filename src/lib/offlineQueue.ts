import * as SecureStore from 'expo-secure-store';
import { SENSITIVE_FIELDS, type SensitiveFieldPath } from '@/security/sensitiveFields';

export type OfflineOperation = {
  key: string;
  payload?: any;
  createdAt: number;
  tries: number;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
};

export type SendFn = (tx: OfflineOperation) => Promise<Response | { ok: boolean; status: number }>;

export const OFFLINE_QUEUE_KEY = 'handover_offline_queue_v1';

async function readStoredQueue(): Promise<OfflineOperation[]> {
  const raw = await SecureStore.getItemAsync(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      ...item,
      createdAt: typeof item?.createdAt === 'number' ? item.createdAt : Date.now(),
      tries: typeof item?.tries === 'number' ? item.tries : 0,
    })) as OfflineOperation[];
  } catch {
    // si hay datos corruptos, empezamos desde cola vacía
    return [];
  }
}

async function writeStoredQueue(queue: OfflineOperation[]): Promise<void> {
  const raw = JSON.stringify(queue);
  await SecureStore.setItemAsync(OFFLINE_QUEUE_KEY, raw);
}

async function clearStoredQueue(): Promise<void> {
  await SecureStore.deleteItemAsync(OFFLINE_QUEUE_KEY);
}

function hasPath(payload: any, path: SensitiveFieldPath): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const segments = path.split('.');
  let current: any = payload;

  for (const segment of segments) {
    if (current == null || (typeof current !== 'object' && !Array.isArray(current))) return false;
    if (!(segment in current)) return false;
    current = current[segment as keyof typeof current];
  }

  return current !== undefined;
}

function findSensitiveFields(payload: any): SensitiveFieldPath[] {
  if (payload == null || typeof payload !== 'object') return [];
  return SENSITIVE_FIELDS.filter((field) => hasPath(payload, field));
}

export async function enqueueTx(input: { key?: string; payload?: any }): Promise<OfflineOperation> {
  const key = input.key ?? `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const createdAt = Date.now();
  const sensitiveFields = input.payload ? findSensitiveFields(input.payload) : [];
  const item: OfflineOperation = {
    key,
    payload: input.payload,
    createdAt,
    tries: 0,
    sensitiveFields: sensitiveFields.length > 0 ? sensitiveFields : undefined,
  };

  const queue = await readStoredQueue();
  const existingIndex = queue.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    queue[existingIndex] = item;
  } else {
    queue.push(item);
  }

  await writeStoredQueue(queue);
  return item;
}

export async function readQueue(): Promise<OfflineOperation[]> {
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
    const updated: OfflineOperation = { ...item, tries: (item.tries ?? 0) + 1 };
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
