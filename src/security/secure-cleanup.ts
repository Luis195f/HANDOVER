import { clearAll as clearLegacyOfflineQueue } from '@/src/lib/offlineQueue';
import { clearAuditStorage } from '@/src/lib/audit';
import { clearAllDrafts } from '@/src/lib/drafts';
import { clearExceptionHandoverStorage } from '@/src/lib/exception-handover-storage';
import { clearOfflineEncryptionKeys } from '@/src/lib/crypto';
import { clearOfflineQueue, clearTxQueue } from '@/src/lib/queue';
import { invalidateCapabilitiesCache } from '@/src/security/capabilities';
import { clearCryptoKeys } from '@/src/security/crypto';
import { clearAllUsers, createUserSwitchStorage } from '@/src/security/user-switch';

export async function clearSensitiveLocalData(): Promise<void> {
  const tasks = [
    clearTxQueue(),
    clearOfflineQueue(),
    clearLegacyOfflineQueue(),
    clearAuditStorage(),
    clearAllDrafts(),
    clearExceptionHandoverStorage(),
    invalidateCapabilitiesCache(),
    clearCryptoKeys(),
    clearOfflineEncryptionKeys(),
    clearAllUsers(createUserSwitchStorage()),
  ];

  await Promise.allSettled(tasks);
}
