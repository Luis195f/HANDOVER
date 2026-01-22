import { decryptOfflinePayload, encryptOfflinePayload } from './crypto';

export type AsyncStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null);
}

export async function getAsyncStorageAdapter(): Promise<AsyncStorageAdapter | null> {
  const mod = await import('@react-native-async-storage/async-storage');
  const storage =
    (mod as { default?: Partial<AsyncStorageAdapter> }).default ??
    (mod as Partial<AsyncStorageAdapter>);
  if (storage?.getItem && storage?.setItem && storage?.removeItem) {
    return storage as AsyncStorageAdapter;
  }
  return null;
}

export async function encryptedSetItem(
  key: string,
  value: unknown,
  storage?: AsyncStorageAdapter | null
): Promise<void> {
  const adapter = storage ?? (await getAsyncStorageAdapter());
  if (!adapter) return;
  const serialized = serializeValue(value);
  const encrypted = await encryptOfflinePayload(serialized);
  await adapter.setItem(key, encrypted);
}

export async function encryptedGetItem(
  key: string,
  storage?: AsyncStorageAdapter | null
): Promise<string | null> {
  const adapter = storage ?? (await getAsyncStorageAdapter());
  if (!adapter) return null;
  const raw = await adapter.getItem(key);
  if (!raw) return raw;
  try {
    return await decryptOfflinePayload(raw);
  } catch {
    return raw;
  }
}

export async function encryptedRemoveItem(
  key: string,
  storage?: AsyncStorageAdapter | null
): Promise<void> {
  const adapter = storage ?? (await getAsyncStorageAdapter());
  if (!adapter) return;
  await adapter.removeItem(key);
}
