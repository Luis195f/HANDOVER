import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOfflineQueue, deleteOfflineQueueItem, enqueueBundle } from '@/src/lib/queue';
import { useHandoverSyncStatus } from '@/src/screens/handover/useHandoverSyncStatus';

const ensureFreshAccessTokenMock = vi.fn();
const flushQueueMock = vi.fn();
const recentlySyncedQueueIds = new Map<string, number>();
const originalNodeEnv = process.env.NODE_ENV;
const originalOfflineEncryptionDisabled = process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

vi.mock('@/src/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));

vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: (...args: unknown[]) => ensureFreshAccessTokenMock(...args),
}));

vi.mock('@/src/lib/sync/index', () => ({
  flushQueue: (...args: unknown[]) => flushQueueMock(...args),
  consumeRecentlySyncedQueueItem: (id: string, opts?: { minCompletedAt?: number }) => {
    const completedAt = recentlySyncedQueueIds.get(id);
    if (completedAt == null) {
      return false;
    }
    recentlySyncedQueueIds.delete(id);
    if (typeof opts?.minCompletedAt === 'number' && completedAt < opts.minCompletedAt) {
      return false;
    }
    return true;
  },
}));

vi.mock('@/src/lib/sync', () => ({
  getSyncSnapshot: () => ({
    status: 'idle',
    lastRunAt: null,
    pendingCount: 0,
    lastError: null,
    nextRetryAt: null,
  }),
  subscribeSyncStatus: (
    listener: (snapshot: {
      status: 'idle';
      lastRunAt: null;
      pendingCount: 0;
      lastError: null;
      nextRetryAt: null;
    }) => void,
  ) => {
    listener({
      status: 'idle',
      lastRunAt: null,
      pendingCount: 0,
      lastError: null,
      nextRetryAt: null,
    });
    return () => {};
  },
}));

function HookHarness({ queueId, initializeQueued = true }: { queueId: string | null; initializeQueued?: boolean }) {
  const {
    handoverSyncStatus,
    handoverSyncError,
    retrySync,
    setHandoverSyncStatus,
    setTrackedQueueId,
  } = useHandoverSyncStatus();
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setTrackedQueueId(queueId);
    setHandoverSyncStatus(queueId && initializeQueued ? 'queued' : 'idle');
  }, [initializeQueued, queueId, setHandoverSyncStatus, setTrackedQueueId]);

  return (
    <View>
      <Text testID="status">{handoverSyncStatus}</Text>
      <Text testID="error">{handoverSyncError ?? ''}</Text>
      <Pressable testID="retry" onPress={retrySync} />
    </View>
  );
}

describe('useHandoverSyncStatus', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recentlySyncedQueueIds.clear();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    await clearOfflineQueue();
  });

  afterEach(async () => {
    await clearOfflineQueue();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = originalOfflineEncryptionDisabled;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('marks the handover as synced only when the queue item disappears with explicit success evidence', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-sync' },
    );

    const view = render(<HookHarness queueId={queued.id} />);

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('queued');
    });

    recentlySyncedQueueIds.set(queued.id, Date.now());
    await deleteOfflineQueueItem(queued.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('synced');
    });
  });

  it('does not mark the handover as synced when the queue item disappears without explicit success evidence', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-terminal-failure' },
    );

    const view = render(<HookHarness queueId={queued.id} />);

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('queued');
    });

    await deleteOfflineQueueItem(queued.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('error');
    });
    expect(view.getByTestId('error').props.children).toBe('sync.syncErrorTitle');
  });

  it('ignores stale success evidence from an older replay for the same deterministic queue id', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-stale-evidence' },
    );

    recentlySyncedQueueIds.set(queued.id, Date.now() - 60_000);

    const view = render(<HookHarness queueId={queued.id} />);

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('queued');
    });

    await deleteOfflineQueueItem(queued.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('error');
    });
  });

  it('keeps the handover out of synced when a retry finishes without explicit success evidence', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-retry-without-evidence' },
    );

    const view = render(<HookHarness queueId={queued.id} />);

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('queued');
    });

    await deleteOfflineQueueItem(queued.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('error');
    });

    ensureFreshAccessTokenMock.mockResolvedValueOnce('session-token');
    flushQueueMock.mockResolvedValueOnce({ processed: 0, remaining: 0 });

    await act(async () => {
      await view.getByTestId('retry').props.onPress();
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('error');
    });
    expect(view.getByTestId('status').props.children).not.toBe('synced');
  });

  it('passes the canonical auth refresher to flushQueue and never snapshots the token', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-retry' },
    );

    const view = render(<HookHarness queueId={queued.id} initializeQueued={false} />);

    ensureFreshAccessTokenMock.mockResolvedValueOnce(null);
    flushQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      const token = await opts.getToken();
      return { processed: 0, remaining: 0, outcome: token ? 'success' : 'auth-required' };
    });
    await act(async () => {
      await view.getByTestId('retry').props.onPress();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(flushQueueMock).toHaveBeenCalledTimes(1);
    expect(ensureFreshAccessTokenMock).toHaveBeenNthCalledWith(1, 'fhir');

    ensureFreshAccessTokenMock
      .mockResolvedValueOnce('fresh-replay-token-1')
      .mockResolvedValueOnce('fresh-replay-token-2');
    flushQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      await opts.getToken();
      await opts.getToken();
      recentlySyncedQueueIds.set(queued.id, Date.now());
      await deleteOfflineQueueItem(queued.id);
      return { processed: 1, remaining: 0, outcome: 'success' };
    });

    await act(async () => {
      await view.getByTestId('retry').props.onPress();
    });

    expect(ensureFreshAccessTokenMock).toHaveBeenNthCalledWith(2, 'fhir');
    expect(ensureFreshAccessTokenMock).toHaveBeenNthCalledWith(3, 'fhir');
    expect(flushQueueMock).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('synced');
    });
  });

  it('preserves auth-failed semantics by passing a throwing refresher into flushQueue', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-refresh-failed' },
    );

    const view = render(<HookHarness queueId={queued.id} initializeQueued={false} />);

    ensureFreshAccessTokenMock.mockRejectedValueOnce(new Error('refresh failed'));
    flushQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      try {
        await opts.getToken();
        return { processed: 0, remaining: 0, outcome: 'success' };
      } catch {
        return { processed: 0, remaining: 0, outcome: 'auth-failed' };
      }
    });

    await act(async () => {
      await view.getByTestId('retry').props.onPress();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(flushQueueMock).toHaveBeenCalledTimes(1);
    expect(ensureFreshAccessTokenMock).toHaveBeenCalledWith('fhir');
  });
});
