import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/offlineQueue', () => ({ clearAll: vi.fn(async () => {}) }));
vi.mock('@/src/lib/audit', () => ({ clearAuditStorage: vi.fn(async () => {}) }));
vi.mock('@/src/lib/drafts', () => ({ clearAllDrafts: vi.fn(async () => {}) }));
vi.mock('@/src/lib/crypto', () => ({ clearOfflineEncryptionKeys: vi.fn(async () => {}) }));
vi.mock('@/src/lib/queue', () => ({ clearOfflineQueue: vi.fn(async () => {}), clearTxQueue: vi.fn(async () => {}) }));
vi.mock('@/src/security/capabilities', () => ({ clearCapabilitiesCache: vi.fn(async () => {}) }));
vi.mock('@/src/security/crypto', () => ({ clearCryptoKeys: vi.fn(async () => {}) }));
vi.mock('@/src/security/user-switch', () => ({
  clearAllUsers: vi.fn(async () => {}),
  createUserSwitchStorage: vi.fn(() => ({})),
}));

import { clearSensitiveLocalData } from '@/src/security/secure-cleanup';
import { clearAll as clearLegacyOfflineQueue } from '@/src/lib/offlineQueue';
import { clearAuditStorage } from '@/src/lib/audit';
import { clearAllDrafts } from '@/src/lib/drafts';
import { clearOfflineEncryptionKeys } from '@/src/lib/crypto';
import { clearOfflineQueue, clearTxQueue } from '@/src/lib/queue';
import { clearCapabilitiesCache } from '@/src/security/capabilities';
import { clearCryptoKeys } from '@/src/security/crypto';
import { clearAllUsers, createUserSwitchStorage } from '@/src/security/user-switch';

describe('clearSensitiveLocalData', () => {
  it('clears all sensitive local stores', async () => {
    await clearSensitiveLocalData();

    expect(clearTxQueue).toHaveBeenCalled();
    expect(clearOfflineQueue).toHaveBeenCalled();
    expect(clearLegacyOfflineQueue).toHaveBeenCalled();
    expect(clearAuditStorage).toHaveBeenCalled();
    expect(clearAllDrafts).toHaveBeenCalled();
    expect(clearCapabilitiesCache).toHaveBeenCalled();
    expect(clearCryptoKeys).toHaveBeenCalled();
    expect(clearOfflineEncryptionKeys).toHaveBeenCalled();
    expect(createUserSwitchStorage).toHaveBeenCalled();
    expect(clearAllUsers).toHaveBeenCalled();
  });
});
