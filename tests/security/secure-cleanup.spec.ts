import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({ secure: new Map<string, string>(), async: new Map<string, string>(), failLegacyDelete: false }));
const nativeKey = (key: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('Invalid SecureStore key');
};
vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async (key: string) => { nativeKey(key); return stores.secure.get(key) ?? null; }),
  setItemAsync: vi.fn(async (key: string, value: string) => { nativeKey(key); stores.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { nativeKey(key); stores.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => stores.async.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { stores.async.set(key, value); }),
  removeItem: vi.fn(async (key: string) => {
    if (key === '@handover/tx-queue' && stores.failLegacyDelete) throw new Error('delete failed');
    stores.async.delete(key);
  }),
} }));

vi.mock('@/src/lib/offlineQueue', () => ({ clearAll: vi.fn(async () => {}) }));
vi.mock('@/src/lib/audit', () => ({ clearAuditStorage: vi.fn(async () => {}) }));
vi.mock('@/src/lib/drafts', () => ({ clearAllDrafts: vi.fn(async () => {}) }));
vi.mock('@/src/lib/exception-handover-storage', () => ({ clearExceptionHandoverStorage: vi.fn(async () => {}) }));
vi.mock('@/src/lib/crypto', () => ({ clearOfflineEncryptionKeys: vi.fn(async () => {}) }));
vi.mock('@/src/lib/queue', () => ({ clearOfflineQueue: vi.fn(async () => {}), clearTxQueue: vi.fn(async () => {}) }));
vi.mock('@/src/security/capabilities', () => ({ invalidateCapabilitiesCache: vi.fn(async () => {}) }));
vi.mock('@/src/security/crypto', () => ({ clearCryptoKeys: vi.fn(async () => {}) }));
vi.mock('@/src/security/user-switch', () => ({
  clearAllUsers: vi.fn(async () => {}),
  createUserSwitchStorage: vi.fn(() => ({})),
}));

import { clearSensitiveLocalData } from '@/src/security/secure-cleanup';
import { clearAll as clearLegacyOfflineQueue } from '@/src/lib/offlineQueue';
import { clearAuditStorage } from '@/src/lib/audit';
import { clearAllDrafts } from '@/src/lib/drafts';
import { clearExceptionHandoverStorage } from '@/src/lib/exception-handover-storage';
import { clearOfflineEncryptionKeys } from '@/src/lib/crypto';
import { clearOfflineQueue, clearTxQueue } from '@/src/lib/queue';
import { invalidateCapabilitiesCache } from '@/src/security/capabilities';
import { clearCryptoKeys } from '@/src/security/crypto';
import { clearAllUsers, createUserSwitchStorage } from '@/src/security/user-switch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

describe('clearSensitiveLocalData', () => {
  beforeEach(() => {
    stores.secure.clear();
    stores.async.clear();
    stores.failLegacyDelete = false;
    vi.clearAllMocks();
  });

  it('clears all sensitive local stores', async () => {
    stores.async.set('@handover/tx-queue', 'synthetic ciphertext');
    expect((await clearSensitiveLocalData()).status).toBe('complete');
    expect(stores.async.has('@handover/tx-queue')).toBe(false);

    expect(clearTxQueue).toHaveBeenCalled();
    expect(clearOfflineQueue).toHaveBeenCalled();
    expect(clearLegacyOfflineQueue).toHaveBeenCalled();
    expect(clearAuditStorage).toHaveBeenCalled();
    expect(clearAllDrafts).toHaveBeenCalled();
    expect(clearExceptionHandoverStorage).toHaveBeenCalled();
    expect(invalidateCapabilitiesCache).toHaveBeenCalled();
    expect(clearCryptoKeys).toHaveBeenCalled();
    expect(clearOfflineEncryptionKeys).toHaveBeenCalled();
    expect(createUserSwitchStorage).toHaveBeenCalled();
    expect(clearAllUsers).toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('handover.queue.v1');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('handover.queue.dead.v1');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalledWith('@handover/tx-queue');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@handover/tx-queue');
  });

  it('allows an absent historical queue and retains keys after a real deletion failure until retry', async () => {
    expect((await clearSensitiveLocalData()).status).toBe('complete');
    stores.async.set('@handover/tx-queue', 'synthetic ciphertext');
    stores.failLegacyDelete = true;
    vi.mocked(clearCryptoKeys).mockClear();
    vi.mocked(clearOfflineEncryptionKeys).mockClear();
    expect(await clearSensitiveLocalData()).toEqual({ status: 'incomplete', failedStores: ['legacy-tx-queue'] });
    expect(stores.async.has('@handover/tx-queue')).toBe(true);
    expect(clearCryptoKeys).not.toHaveBeenCalled();
    expect(clearOfflineEncryptionKeys).not.toHaveBeenCalled();
    stores.failLegacyDelete = false;
    expect((await clearSensitiveLocalData()).status).toBe('complete');
    expect(stores.async.has('@handover/tx-queue')).toBe(false);
  });

  it('retains encryption keys when a payload store cannot be cleared', async () => {
    vi.mocked(clearAllDrafts).mockRejectedValueOnce(new Error('synthetic failure'));
    vi.mocked(clearCryptoKeys).mockClear();
    vi.mocked(clearOfflineEncryptionKeys).mockClear();
    const result = await clearSensitiveLocalData();
    expect(result).toEqual({ status: 'incomplete', failedStores: ['drafts'] });
    expect(clearCryptoKeys).not.toHaveBeenCalled();
    expect(clearOfflineEncryptionKeys).not.toHaveBeenCalled();
  });
});
