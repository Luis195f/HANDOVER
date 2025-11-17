import * as SecureStore from 'expo-secure-store';
import { SENSITIVE_FIELDS, type SensitiveFieldPath } from '@/security/sensitiveFields';

export type QueueItem = {
  key: string;
  payload?: any;
  createdAt: number;
  tries: number;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
};

export type SendFn = (tx: QueueItem) => Promise<Response | { ok: boolean; status: number }>;

export const QUEUE_DIR = 'handover_queue';

const INDEX_KEY = `${QUEUE_DIR}:__index__`;

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(keys: string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(keys));
}

function itemKey(key: string): string {
  return `${QUEUE_DIR}:${key}`;
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

async function readItem(key: string): Promise<QueueItem | undefined> {
  const raw = await SecureStore.getItemAsync(itemKey(key));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as QueueItem;
    if (typeof parsed.createdAt !== 'number') parsed.createdAt = Date.now();
    if (typeof parsed.tries !== 'number') parsed.tries = 0;
    return parsed;
  } catch {
    return undefined;
  }
}

async function saveItem(item: QueueItem): Promise<void> {
  await SecureStore.setItemAsync(itemKey(item.key), JSON.stringify(item));
}

export async function enqueueTx(input: { key?: string; payload?: any }): Promise<QueueItem> {
  const key = input.key ?? `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const createdAt = Date.now();
  const sensitiveFields = input.payload ? findSensitiveFields(input.payload) : [];
  const item: QueueItem = {
    key,
    payload: input.payload,
    createdAt,
    tries: 0,
    sensitiveFields: sensitiveFields.length > 0 ? sensitiveFields : undefined,
  };

  const keys = await readIndex();
  if (!keys.includes(key)) {
    keys.push(key);
    await writeIndex(keys);
  }

  await saveItem(item);
  return item;
}

export async function readQueue(): Promise<QueueItem[]> {
  const keys = await readIndex();
  const items: QueueItem[] = [];
  for (const key of keys) {
    const item = await readItem(key);
    if (item) items.push(item);
  }
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeItem(key: string): Promise<void> {
  const keys = await readIndex();
  const next = keys.filter((k) => k !== key);
  if (next.length !== keys.length) {
    await writeIndex(next);
  }
  await SecureStore.deleteItemAsync(itemKey(key));
}

export async function clearAll(): Promise<void> {
  const keys = await readIndex();
  for (const key of keys) {
    await SecureStore.deleteItemAsync(itemKey(key));
  }
  await SecureStore.deleteItemAsync(INDEX_KEY);
}

export async function flushQueue(sender: SendFn): Promise<void> {
  const keys = await readIndex();
  for (const key of [...keys]) {
    const item = await readItem(key);
    if (!item) {
      await removeItem(key);
      continue;
    }

    const updated: QueueItem = { ...item, tries: (item.tries ?? 0) + 1 };
    await saveItem(updated);

    const res = await sender(updated);
    const status = 'status' in res ? res.status : (res as Response)?.status;
    if (res.ok || status === 201 || status === 200 || status === 412) {
      await removeItem(key);
    } else {
      break;
    }
  }
}
