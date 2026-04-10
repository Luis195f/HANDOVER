import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '@/src/i18n';

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

const mocked = vi.hoisted(() => ({
  listOfflineQueue: vi.fn(),
}));

const navigationMock = {
  navigate: vi.fn(),
  goBack: vi.fn(),
  addListener: vi.fn(() => vi.fn()),
  dispatch: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
};

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => navigationMock,
  useRoute: () => ({ params: {} }),
}));

vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: (...args: unknown[]) => mocked.listOfflineQueue(...args),
}));

vi.mock('@/src/lib/sync/index', () => ({
  flushQueue: vi.fn(async () => ({ processed: 0, remaining: 1 })),
}));

vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: vi.fn(async () => 'token'),
}));

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));

describe('SyncCenter canonical queue source', () => {
  let queuedId = '';

  beforeEach(async () => {
    queuedId = '';
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';
    mocked.listOfflineQueue.mockReset();
    const actualQueue = await vi.importActual<typeof import('@/src/lib/queue')>('@/src/lib/queue');
    await actualQueue.clearOfflineQueue();
    const { buildTransactionBundleForQueue } = await import('@/src/lib/sync');
    const queued = await actualQueue.enqueueBundle(
      buildTransactionBundleForQueue({ patientId: 'pat-sync-center' } as any, {
        now: '2025-01-01T00:00:00.000Z',
      }),
      { patientId: 'pat-sync-center' },
    );
    queuedId = queued.id;
    mocked.listOfflineQueue.mockResolvedValue(await actualQueue.listOfflineQueue());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
    delete process.env.NODE_ENV;
  });

  it('renders the real handover item stored in the canonical offline queue', async () => {
    expect(mocked.listOfflineQueue).not.toHaveBeenCalled();

    const { default: SyncCenter } = await import('@/src/screens/SyncCenter');
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(mocked.listOfflineQueue).toHaveBeenCalled();
    });

    expect(view.getByText(t('sync.attemptsLabel', { count: 0 }))).toBeTruthy();
    expect(view.getByText(t('sync.status.pending'))).toBeTruthy();

    expect(view.queryByText(t('sync.emptyQueue'))).toBeNull();
  });
});

