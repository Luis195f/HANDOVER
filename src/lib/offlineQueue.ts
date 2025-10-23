import * as SecureStore from 'expo-secure-store';

export type QueueItem = {
  key: string;
  payload?: any;
  createdAt: number;
  tries: number;
  hash?: string;
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
  const item: QueueItem = { key, payload: input.payload, createdAt, tries: 0 };

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
