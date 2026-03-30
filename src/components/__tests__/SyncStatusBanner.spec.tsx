import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigationMock = {
  navigate: vi.fn(),
};

const queueSizeMock = vi.fn();

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => navigationMock,
}));

vi.mock('@/src/theme', () => ({
  useThemeTokens: () => ({
    colors: {
      danger: '#b91c1c',
      warning: '#d97706',
      info: '#2563eb',
      success: '#15803d',
      primary: '#1d4ed8',
      text: '#111827',
    },
  }),
}));

vi.mock('@/src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number | undefined>) =>
      params?.count != null ? `${key}:${params.count}` : key,
  }),
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

vi.mock('@/src/lib/sync/index', () => ({
  getQueueSize: (...args: unknown[]) => queueSizeMock(...args),
}));

describe('SyncStatusBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueSizeMock.mockResolvedValue(2);
  });

  it('shows pending canonical queue work even when sync.ts stays idle', async () => {
    const { default: SyncStatusBanner } = await import('@/src/components/SyncStatusBanner');
    const view = render(<SyncStatusBanner />);

    await waitFor(() => {
      expect(queueSizeMock).toHaveBeenCalled();
    });

    expect(view.getByText('sync.runningMessage:2')).toBeTruthy();
    expect(view.getByText('sync.pendingCountMessage:2')).toBeTruthy();
  });
});
