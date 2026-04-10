import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureFreshAccessTokenMock = vi.fn();
const flushSyncQueueMock = vi.fn();
const listOfflineQueueMock = vi.fn(async () => []);

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useIsFocused: () => true,
}));

vi.mock('@/src/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('@/src/theme', () => ({
  useThemeTokens: () => ({
    colors: {
      background: '#fff',
      text: '#111',
      muted: '#666',
      surface: '#f5f5f5',
      border: '#ddd',
      info: '#00f',
      primary: '#0a0',
      onPrimary: '#fff',
      warning: '#fa0',
      danger: '#d00',
    },
    fontSizes: { xl: 20, lg: 16, base: 14 },
    radius: { sm: 8 },
  }),
}));

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test/fhir',
}));

vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: (service?: string) => ensureFreshAccessTokenMock(service),
}));

vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: () => listOfflineQueueMock(),
}));

vi.mock('@/src/lib/sync', () => ({
  flushSyncQueue: (opts: unknown) => flushSyncQueueMock(opts),
}));

vi.mock('@/src/lib/net-errors', () => ({
  normalizeNetError: (error: unknown) => error,
  getUserFacingNetworkMessage: () => ({ title: 'sync.error', message: 'sync.error' }),
}));

vi.mock('@/src/screens/SyncCenter.helpers', () => ({
  buildIssuesText: () => '',
  parseErrorIssuesJson: () => [],
  resolveErrorCopy: () => ({
    subtitle: 'sync.status.error',
    title: 'sync.syncErrorTitle',
    message: 'sync.syncErrorTitle',
  }),
}));

describe('SyncCenter auth replay seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the canonical fhir refresher for manual flush instead of a snapshot token', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    ensureFreshAccessTokenMock
      .mockResolvedValueOnce('fresh-replay-token-1')
      .mockResolvedValueOnce('fresh-replay-token-2');
    flushSyncQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      expect(await opts.getToken()).toBe('fresh-replay-token-1');
      expect(await opts.getToken()).toBe('fresh-replay-token-2');
      return { processed: 1, remaining: 0, outcome: 'success' };
    });

    const { default: SyncCenter } = await import('@/src/screens/SyncCenter');
    const view = render(<SyncCenter />);

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    await waitFor(() => {
      expect(flushSyncQueueMock).toHaveBeenCalledTimes(1);
    });
    expect(ensureFreshAccessTokenMock).toHaveBeenNthCalledWith(1, 'fhir');
    expect(ensureFreshAccessTokenMock).toHaveBeenNthCalledWith(2, 'fhir');
    expect(alertSpy).not.toHaveBeenCalledWith('sync.syncTitle', 'sync.authRequiredMessage');
    expect(alertSpy).not.toHaveBeenCalledWith('sync.syncTitle', 'sync.authFailedMessage');
    alertSpy.mockRestore();
  });

  it('fails closed when the canonical refresher does not return a bearer', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    ensureFreshAccessTokenMock.mockResolvedValueOnce(null);
    flushSyncQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      const token = await opts.getToken();
      return { processed: 0, remaining: 0, outcome: token ? 'success' : 'auth-required' };
    });

    const { default: SyncCenter } = await import('@/src/screens/SyncCenter');
    const view = render(<SyncCenter />);

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    expect(flushSyncQueueMock).toHaveBeenCalledTimes(1);
    expect(ensureFreshAccessTokenMock).toHaveBeenCalledWith('fhir');
    expect(alertSpy).toHaveBeenCalledWith('sync.syncTitle', 'sync.authRequiredMessage');
    alertSpy.mockRestore();
  });

  it('preserves auth-failed when the canonical refresher throws', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    ensureFreshAccessTokenMock.mockRejectedValueOnce(new Error('refresh failed'));
    flushSyncQueueMock.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      try {
        await opts.getToken();
        return { processed: 0, remaining: 0, outcome: 'success' };
      } catch {
        return { processed: 0, remaining: 0, outcome: 'auth-failed' };
      }
    });

    const { default: SyncCenter } = await import('@/src/screens/SyncCenter');
    const view = render(<SyncCenter />);

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    expect(flushSyncQueueMock).toHaveBeenCalledTimes(1);
    expect(ensureFreshAccessTokenMock).toHaveBeenCalledWith('fhir');
    expect(alertSpy).toHaveBeenCalledWith('sync.syncTitle', 'sync.authFailedMessage');
    alertSpy.mockRestore();
  });
});
