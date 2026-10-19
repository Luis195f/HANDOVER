import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@/src/security/secure-storage', () => ({ secureDeleteSensitiveItem: vi.fn(async () => {}) }));

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
import { secureDeleteSensitiveItem } from '@/src/security/secure-storage';

describe('clearSensitiveLocalData', () => {
  it('clears all sensitive local stores', async () => {
    expect((await clearSensitiveLocalData()).status).toBe('complete');

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
    expect(secureDeleteSensitiveItem).toHaveBeenCalledWith('handover.queue.v1');
    expect(secureDeleteSensitiveItem).toHaveBeenCalledWith('handover.queue.dead.v1');
    expect(secureDeleteSensitiveItem).toHaveBeenCalledWith('@handover/tx-queue');
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
