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
import { beginLocalCleanup, endLocalCleanup } from '@/src/security/local-cleanup-state';

export type LocalCleanupResult = {
  status: 'complete' | 'incomplete' | 'failed';
  failedStores: string[];
};

export async function clearSensitiveLocalData(): Promise<LocalCleanupResult> {
  beginLocalCleanup();
  try {
    const stores = [
      ['tx-queue', clearTxQueue],
      ['offline-queue', clearOfflineQueue],
      ['legacy-offline-queue', clearLegacyOfflineQueue],
      ['audit', clearAuditStorage],
      ['drafts', clearAllDrafts],
      ['exception-handover', clearExceptionHandoverStorage],
      ['secure-queue', () => secureDeleteSensitiveItem('handover.queue.v1')],
      ['dead-queue', () => secureDeleteSensitiveItem('handover.queue.dead.v1')],
      ['legacy-tx-queue', () => secureDeleteSensitiveItem('@handover/tx-queue')],
      ['capabilities', invalidateCapabilitiesCache],
      ['users', () => clearAllUsers(createUserSwitchStorage())],
    ] as const;
    const failedStores: string[] = [];
    for (const [name, clear] of stores) {
      try { await clear(); } catch { failedStores.push(name); }
    }
    if (failedStores.length === 0) {
      try { await clearCryptoKeys(); } catch { failedStores.push('crypto-keys'); }
      try { await clearOfflineEncryptionKeys(); } catch { failedStores.push('offline-keys'); }
    }
    return {
      status: failedStores.length === 0 ? 'complete' : failedStores.length === stores.length ? 'failed' : 'incomplete',
      failedStores,
    };
  } finally {
    endLocalCleanup();
  }
}
