import { useCallback, useEffect, useState } from 'react';

import { FHIR_BASE_URL } from '@/src/config/env';
import { t } from '@/src/i18n';
import { getOfflineQueueItem } from '@/src/lib/queue';
import { getSyncSnapshot, subscribeSyncStatus } from '@/src/lib/sync';
import { consumeRecentlySyncedQueueItem, flushQueue } from '@/src/lib/sync/index';
import { ensureFreshAccessToken } from '@/src/security/auth';

export type HandoverSyncStatus = 'idle' | 'queued' | 'syncing' | 'synced' | 'error';

const HANDOVER_SYNC_POLL_MS = 2_000;

export function useHandoverSyncStatus() {
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot());
  const [handoverSyncStatus, setHandoverSyncStatus] = useState<HandoverSyncStatus>('idle');
  const [handoverSyncError, setHandoverSyncError] = useState<string | null>(null);
  const [trackedQueueId, setTrackedQueueId] = useState<string | null>(null);
  const [manualSyncBlock, setManualSyncBlock] = useState<string | null>(null);

  const refreshTrackedQueue = useCallback(async () => {
    if (!trackedQueueId || handoverSyncStatus === 'idle') return;

    const queueItem = await getOfflineQueueItem(trackedQueueId);
    if (!queueItem) {
      setTrackedQueueId(null);
      if (consumeRecentlySyncedQueueItem(trackedQueueId)) {
        setManualSyncBlock(null);
        setHandoverSyncStatus('synced');
        setHandoverSyncError(null);
        return;
      }

      const message = manualSyncBlock ?? syncSnapshot.lastError ?? t('sync.syncErrorTitle');
      setHandoverSyncStatus('error');
      setHandoverSyncError(message);
      return;
    }

    if (manualSyncBlock) {
      setHandoverSyncStatus('error');
      setHandoverSyncError(manualSyncBlock);
      return;
    }

    if (queueItem.syncStatus === 'error') {
      setHandoverSyncStatus('error');
      setHandoverSyncError(queueItem.errorMessage ?? null);
      return;
    }

    if (queueItem.syncStatus === 'pending' || queueItem.syncStatus === 'inFlight') {
      const nextStatus =
        queueItem.attemptCount > 0 || Boolean(queueItem.lastAttemptAt) || queueItem.syncStatus === 'inFlight'
          ? 'syncing'
          : 'queued';
      setHandoverSyncStatus(nextStatus);
      setHandoverSyncError(null);
      return;
    }

    setTrackedQueueId(null);
    setHandoverSyncStatus('synced');
    setHandoverSyncError(null);
  }, [handoverSyncStatus, manualSyncBlock, syncSnapshot.lastError, trackedQueueId]);

  const retrySync = useCallback(async () => {
    if (!FHIR_BASE_URL) {
      const message = t('sync.configMissingMessage');
      setManualSyncBlock(message);
      setHandoverSyncStatus('error');
      setHandoverSyncError(message);
      return;
    }

    const token = await ensureFreshAccessToken('fhir').catch(() => null);
    if (!token) {
      const message = t('sync.authRequiredMessage');
      setManualSyncBlock(message);
      setHandoverSyncStatus('error');
      setHandoverSyncError(message);
      return;
    }

    setManualSyncBlock(null);
    setHandoverSyncStatus('syncing');
    setHandoverSyncError(null);

    await flushQueue({
      fhirBaseUrl: FHIR_BASE_URL,
      getToken: async () => token,
      backoff: { retries: 5, minMs: 500, maxMs: 15_000 },
    });

    await refreshTrackedQueue();
  }, [refreshTrackedQueue]);

  useEffect(() => subscribeSyncStatus(setSyncSnapshot), []);

  useEffect(() => {
    if (!trackedQueueId || handoverSyncStatus === 'idle') return;

    void refreshTrackedQueue();
    const interval = setInterval(() => {
      void refreshTrackedQueue();
    }, HANDOVER_SYNC_POLL_MS);

    return () => clearInterval(interval);
  }, [handoverSyncStatus, refreshTrackedQueue, trackedQueueId]);

  useEffect(() => {
    if (handoverSyncStatus === 'idle' || handoverSyncStatus === 'error' || trackedQueueId) return;
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
  }, [handoverSyncStatus, syncSnapshot, trackedQueueId]);

  return {
    syncSnapshot,
    handoverSyncStatus,
    handoverSyncError,
    retrySync,
    setHandoverSyncStatus,
    setHandoverSyncError,
    setTrackedQueueId,
  };
}
