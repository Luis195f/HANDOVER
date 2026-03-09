import { useEffect, useState } from 'react';

import { getSyncSnapshot, subscribeSyncStatus } from '@/src/lib/sync';

export type HandoverSyncStatus = 'idle' | 'queued' | 'syncing' | 'synced' | 'error';

export function useHandoverSyncStatus() {
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot());
  const [handoverSyncStatus, setHandoverSyncStatus] = useState<HandoverSyncStatus>('idle');
  const [handoverSyncError, setHandoverSyncError] = useState<string | null>(null);

  useEffect(() => subscribeSyncStatus(setSyncSnapshot), []);

  useEffect(() => {
    if (handoverSyncStatus === 'idle') return;
    if (syncSnapshot.lastError) {
      setHandoverSyncStatus('error');
      setHandoverSyncError(syncSnapshot.lastError);
      return;
    }
    if (syncSnapshot.status === 'running' || syncSnapshot.pendingCount > 0) {
      setHandoverSyncStatus('syncing');
      setHandoverSyncError(null);
      return;
    }
    if (syncSnapshot.status === 'idle' && syncSnapshot.pendingCount === 0) {
      setHandoverSyncStatus('synced');
      setHandoverSyncError(null);
    }
  }, [handoverSyncStatus, syncSnapshot]);

  return {
    syncSnapshot,
    handoverSyncStatus,
    handoverSyncError,
    setHandoverSyncStatus,
    setHandoverSyncError,
  };
}
