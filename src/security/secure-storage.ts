import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEYCHAIN_SERVICE = 'handover-secure';
const INSECURE_FALLBACK_WARNING_CODE = 'HNDR_SECSTORE_001';
const warnedFallbacks = new Set<string>();

export class SecureStorageUnavailableError extends Error {
  constructor(operation: 'read' | 'write' | 'delete') {
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

function allowInsecureFallback(): boolean {
  return isDevelopmentRuntime();
}

function warnInsecureFallbackOnce(operation: 'read' | 'write' | 'delete', key: string): void {
  const warningKey = `${operation}:${Platform.OS}`;
  if (warnedFallbacks.has(warningKey)) return;
  warnedFallbacks.add(warningKey);
  console.warn(
    `${INSECURE_FALLBACK_WARNING_CODE} SecureStore unavailable on ${Platform.OS}; using AsyncStorage fallback for ${operation}. This is allowed only in dev/test.`,
    { key },
  );
}

async function resolveStorageBackend(
  operation: 'read' | 'write' | 'delete',
): Promise<'secure-store' | 'async-storage'> {
  if (await canUseSecureStore()) {
    return 'secure-store';
  }
  if (allowInsecureFallback()) {
    return 'async-storage';
  }
  throw new SecureStorageUnavailableError(operation);
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  const backend = await resolveStorageBackend('write');
  if (backend === 'secure-store') {
    await SecureStore.setItemAsync(key, value, { keychainService: KEYCHAIN_SERVICE });
    await AsyncStorage.removeItem(key);
    return;
  }
  warnInsecureFallbackOnce('write', key);
  await AsyncStorage.setItem(key, value);
}

export async function secureGetItem(key: string): Promise<string | null> {
  const backend = await resolveStorageBackend('read');
  if (backend === 'secure-store') {
    return SecureStore.getItemAsync(key);
  }
  warnInsecureFallbackOnce('read', key);
  return AsyncStorage.getItem(key);
}

export async function secureDeleteItem(key: string): Promise<void> {
  const backend = await resolveStorageBackend('delete');
  if (backend === 'secure-store') {
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(key);
    return;
  }
  warnInsecureFallbackOnce('delete', key);
  await AsyncStorage.removeItem(key);
}
