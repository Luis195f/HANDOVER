import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEYCHAIN_SERVICE = 'handover-secure';
const INSECURE_FALLBACK_WARNING_CODE = 'HNDR_SECSTORE_001';
const warnedFallbacks = new Set<string>();

type StorageOperation = 'read' | 'write' | 'delete';
type StorageMode = 'compatible' | 'sensitive';
type StorageBackend = 'secure-store' | 'async-storage';

export class SecureStorageUnavailableError extends Error {
  constructor(operation: StorageOperation) {
    super(
      `Secure storage unavailable for ${operation}; refusing insecure AsyncStorage fallback in production.`,
    );
    this.name = 'SecureStorageUnavailableError';
  }
}

async function canUseSecureStore(): Promise<boolean> {
  if (typeof SecureStore.getItemAsync !== 'function') return false;
  if (typeof SecureStore.setItemAsync !== 'function') return false;
  if (typeof SecureStore.deleteItemAsync !== 'function') return false;

  try {
    return (await SecureStore.isAvailableAsync?.()) ?? true;
  } catch {
    return false;
  }
}

function isDevelopmentRuntime(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__ === true;
  }
  return process.env.NODE_ENV !== 'production';
}

function allowInsecureFallback(mode: StorageMode): boolean {
  if (mode === 'compatible') {
    return true;
  }
  return isDevelopmentRuntime();
}

function warnInsecureFallbackOnce(operation: StorageOperation, key: string, mode: StorageMode): void {
  if (mode !== 'sensitive') return;
  const warningKey = `${mode}:${operation}:${Platform.OS}`;
  if (warnedFallbacks.has(warningKey)) return;
  warnedFallbacks.add(warningKey);
  console.warn(
    `${INSECURE_FALLBACK_WARNING_CODE} SecureStore unavailable on ${Platform.OS}; using AsyncStorage fallback for ${operation}. This is allowed only in dev/test.`,
    { key },
  );
}

async function resolveStorageBackend(
  operation: StorageOperation,
  mode: StorageMode = 'compatible',
): Promise<StorageBackend> {
  if (await canUseSecureStore()) {
    return 'secure-store';
  }
  if (allowInsecureFallback(mode)) {
    return 'async-storage';
  }
  throw new SecureStorageUnavailableError(operation);
}

async function setItemWithMode(key: string, value: string, mode: StorageMode): Promise<void> {
  const backend = await resolveStorageBackend('write', mode);
  if (backend === 'secure-store') {
    await SecureStore.setItemAsync(key, value, { keychainService: KEYCHAIN_SERVICE });
    await AsyncStorage.removeItem(key);
    return;
  }
  warnInsecureFallbackOnce('write', key, mode);
  await AsyncStorage.setItem(key, value);
}

async function getItemWithMode(key: string, mode: StorageMode): Promise<string | null> {
  const backend = await resolveStorageBackend('read', mode);
  if (backend === 'secure-store') {
    return SecureStore.getItemAsync(key);
  }
  warnInsecureFallbackOnce('read', key, mode);
  return AsyncStorage.getItem(key);
}

async function deleteItemWithMode(key: string, mode: StorageMode): Promise<void> {
  const backend = await resolveStorageBackend('delete', mode);
  if (backend === 'secure-store') {
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(key);
    return;
  }
  warnInsecureFallbackOnce('delete', key, mode);
  await AsyncStorage.removeItem(key);
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  await setItemWithMode(key, value, 'compatible');
}

export async function secureGetItem(key: string): Promise<string | null> {
  return getItemWithMode(key, 'compatible');
}

export async function secureDeleteItem(key: string): Promise<void> {
  await deleteItemWithMode(key, 'compatible');
}

export async function secureSetSensitiveItem(key: string, value: string): Promise<void> {
  await setItemWithMode(key, value, 'sensitive');
}

export async function secureGetSensitiveItem(key: string): Promise<string | null> {
  return getItemWithMode(key, 'sensitive');
}

export async function secureDeleteSensitiveItem(key: string): Promise<void> {
  await deleteItemWithMode(key, 'sensitive');
}
