import { useCallback, useEffect, useRef, useState } from 'react';

import { FHIR_BASE_URL } from '@/src/config/env';
import { t } from '@/src/i18n';
import { getOfflineQueueItem } from '@/src/lib/queue';
import { consumeRecentlySyncedQueueItem, flushSyncQueue, getSyncSnapshot, subscribeSyncStatus } from '@/src/lib/sync';
import { ensureFreshAccessToken } from '@/src/security/auth';

export type HandoverSyncStatus = 'idle' | 'queued' | 'syncing' | 'synced' | 'error';

const HANDOVER_SYNC_POLL_MS = 2_000;

function getAuthReplayMessage(outcome: 'auth-required' | 'auth-failed'): string {
  return outcome === 'auth-failed' ? t('sync.authFailedMessage') : t('sync.authRequiredMessage');
}

export function useHandoverSyncStatus() {
  const [syncSnapshot, setSyncSnapshot] = useState(getSyncSnapshot());
  const [handoverSyncStatus, setHandoverSyncStatus] = useState<HandoverSyncStatus>('idle');
  const [handoverSyncError, setHandoverSyncError] = useState<string | null>(null);
  const [trackedQueueId, setTrackedQueueIdState] = useState<string | null>(null);
  const [manualSyncBlock, setManualSyncBlock] = useState<string | null>(null);
  const manualRetryInFlightRef = useRef(false);
  const manualSyncBlockRef = useRef<string | null>(null);
  const trackedQueueStartedAtRef = useRef<number | null>(null);

  const setTrackedQueueId = useCallback((nextTrackedQueueId: string | null) => {
    trackedQueueStartedAtRef.current = nextTrackedQueueId ? Date.now() : null;
    setTrackedQueueIdState(nextTrackedQueueId);
  }, []);

  const refreshTrackedQueue = useCallback(async () => {
    if (!trackedQueueId || handoverSyncStatus === 'idle') return;
    if (manualRetryInFlightRef.current) return;

    const queueItem = await getOfflineQueueItem(trackedQueueId);
    if (manualSyncBlockRef.current) {
      setHandoverSyncStatus('error');
      setHandoverSyncError(manualSyncBlockRef.current);
      return;
    }
    if (!queueItem) {
      const trackedQueueStartedAt = trackedQueueStartedAtRef.current;
      setTrackedQueueId(null);
      if (
        consumeRecentlySyncedQueueItem(trackedQueueId, {
          minCompletedAt: trackedQueueStartedAt ?? undefined,
        })
      ) {
        trackedQueueStartedAtRef.current = null;
        manualSyncBlockRef.current = null;
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
    trackedQueueStartedAtRef.current = null;
    setHandoverSyncStatus('synced');
    setHandoverSyncError(null);
  }, [handoverSyncStatus, manualSyncBlock, setTrackedQueueId, syncSnapshot.lastError, trackedQueueId]);

  const retrySync = useCallback(async () => {
    if (!FHIR_BASE_URL) {
      const message = t('sync.configMissingMessage');
      manualSyncBlockRef.current = message;
      setManualSyncBlock(message);
      setHandoverSyncStatus('error');
      setHandoverSyncError(message);
      return;
    }

    manualSyncBlockRef.current = null;
    setManualSyncBlock(null);
    setHandoverSyncStatus('syncing');
    setHandoverSyncError(null);

    manualRetryInFlightRef.current = true;
    try {
      const result = await flushSyncQueue({
        fhirBaseUrl: FHIR_BASE_URL,
        getToken: () => ensureFreshAccessToken('fhir'),
        backoff: { retries: 5, minMs: 500, maxMs: 15_000 },
      });

      if (result.outcome === 'auth-required' || result.outcome === 'auth-failed') {
        const message = getAuthReplayMessage(result.outcome);
        manualSyncBlockRef.current = message;
        setManualSyncBlock(message);
        setHandoverSyncStatus('error');
        setHandoverSyncError(message);
        return;
      }

      await refreshTrackedQueue();
    } finally {
      manualRetryInFlightRef.current = false;
    }
  }, [manualRetryInFlightRef, refreshTrackedQueue]);

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
    if (
      handoverSyncStatus === 'idle' ||
      handoverSyncStatus === 'error' ||
      handoverSyncStatus === 'synced' ||
      trackedQueueId
    ) {
      return;
    }
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
      setHandoverSyncStatus('error');
      setHandoverSyncError(manualSyncBlock ?? t('sync.syncErrorTitle'));
    }
  }, [handoverSyncStatus, manualSyncBlock, syncSnapshot, trackedQueueId]);

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
