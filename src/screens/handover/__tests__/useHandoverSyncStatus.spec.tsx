import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOfflineQueue, deleteOfflineQueueItem, enqueueBundle } from '@/src/lib/queue';
import { useHandoverSyncStatus } from '@/src/screens/handover/useHandoverSyncStatus';

const ensureFreshAccessTokenMock = vi.fn();
const flushQueueMock = vi.fn();
const recentlySyncedQueueIds = new Set<string>();
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
  consumeRecentlySyncedQueueItem: (id: string) => {
    const found = recentlySyncedQueueIds.has(id);
    if (found) {
      recentlySyncedQueueIds.delete(id);
    }
    return found;
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

function HookHarness({ queueId }: { queueId: string | null }) {
  const {
    handoverSyncStatus,
    handoverSyncError,
    retrySync,
    setHandoverSyncStatus,
    setTrackedQueueId,
  } = useHandoverSyncStatus();

  React.useEffect(() => {
    setTrackedQueueId(queueId);
    setHandoverSyncStatus(queueId ? 'queued' : 'idle');
  }, [queueId, setHandoverSyncStatus, setTrackedQueueId]);

  return (
    <View>
      <Text testID="status">{handoverSyncStatus}</Text>
      <Text testID="error">{handoverSyncError ?? ''}</Text>
      <Pressable testID="retry" onPress={() => void retrySync()} />
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

    recentlySyncedQueueIds.add(queued.id);
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
      fireEvent.press(view.getByTestId('retry'));
    });

    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('error');
    });
    expect(view.getByTestId('status').props.children).not.toBe('synced');
  });

  it('retries through the bootstrap auth seam and surfaces auth-required when the session token is missing', async () => {
    const queued = await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-handover-retry' },
    );

    const view = render(<HookHarness queueId={queued.id} />);

    ensureFreshAccessTokenMock.mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.press(view.getByTestId('retry'));
    });

    expect(flushQueueMock).not.toHaveBeenCalled();
    expect(view.getByTestId('status').props.children).toBe('error');
    expect(view.getByTestId('error').props.children).toBe('sync.authRequiredMessage');

    ensureFreshAccessTokenMock.mockResolvedValueOnce('session-token');
    flushQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string> }) => {
      expect(await opts.getToken()).toBe('session-token');
      recentlySyncedQueueIds.add(queued.id);
      await deleteOfflineQueueItem(queued.id);
      return { processed: 1, remaining: 0 };
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('retry'));
    });

    expect(ensureFreshAccessTokenMock).toHaveBeenLastCalledWith('fhir');
    expect(flushQueueMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(view.getByTestId('status').props.children).toBe('synced');
    });
  });
});
