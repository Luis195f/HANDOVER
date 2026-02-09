import React from 'react';
import { Alert, FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SyncCenter from '@/src/screens/SyncCenter';
import { t } from '@/src/i18n';

const listOfflineQueue = vi.fn();
const flushQueue = vi.fn();

// ✅ Declare before vi.mock (hoisting)
const navigationMock = {
  navigate: vi.fn(),
  goBack: vi.fn(),
  addListener: vi.fn(() => vi.fn()),
  dispatch: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
};

// ✅ Full mock (no importActual) to avoid the real NavigationContainer and useBackButton
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => navigationMock,
  useRoute: () => ({ params: {} }),
  NavigationContainer: ({ children }: any) => children,
  useFocusEffect: (cb: any) => cb(),
}));

vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: (...args: unknown[]) => listOfflineQueue(...args),
}));

vi.mock('@/src/lib/sync/index', () => ({
  flushQueue: (...args: unknown[]) => flushQueue(...args),
}));

vi.mock('@/src/services/AuthService', () => ({
  getToken: vi.fn(async () => 'token'),
  default: { getToken: vi.fn(async () => 'token') },
}));

vi.mock('@/src/config/env', () => ({
  ENV: { FHIR_BASE: 'https://example.test' },
  FHIR_BASE: 'https://example.test',
}));

const queueItems = [
  {
    id: 'pending-1',
    createdAt: '2024-01-01T00:00:00Z',
    attempts: 1,
    syncStatus: 'pending',
  },
  {
    id: 'error-1',
    createdAt: '2024-01-02T00:00:00Z',
    attempts: 2,
    syncStatus: 'error',
    errorMessage: 'Fallo de sincronización',
    errorStatus: 500,
  },
];

describe('SyncCenter', () => {
  beforeEach(() => {
    listOfflineQueue.mockReset();
    flushQueue.mockReset();

    // Optional, but harmless in tests.
    process.env.EXPO_PUBLIC_FHIR_BASE = 'https://example.test';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'https://example.test';
    process.env.EXPO_PUBLIC_AUTH_TOKEN = 'token';

    listOfflineQueue.mockResolvedValue(queueItems);
    flushQueue.mockResolvedValue({ processed: 2, remaining: 0 });
  });

  it('renders queue items with the expected statuses', async () => {
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    expect(view.getByText(t('sync.title'))).toBeTruthy();
    expect(view.getByTestId('sync-flush')).toBeTruthy();
    expect(view.getByTestId('sync-item-pending-1')).toBeTruthy();
    expect(view.getByTestId('sync-item-error-1')).toBeTruthy();
    expect(view.getByText(t('sync.attemptsLabel', { count: 1 }))).toBeTruthy();
    expect(view.getByText(t('sync.attemptsLabel', { count: 2 }))).toBeTruthy();
    expect(view.getByText(t('sync.status.pending'))).toBeTruthy();
    expect(view.getByText('Error del servidor')).toBeTruthy();
    expect(view.getByText(t('sync.viewError'))).toBeTruthy();
    expect(view.getByText(t('common.error'))).toBeTruthy();
  });

  it('triggers a retry and reloads the queue', async () => {
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    const initialCalls = listOfflineQueue.mock.calls.length;

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    await waitFor(() => {
      expect(flushQueue).toHaveBeenCalled();
    });

    expect(listOfflineQueue.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('allows refreshing the list', async () => {
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    const initialCalls = listOfflineQueue.mock.calls.length;
    const list = view.root.findByType(FlatList);
    const refreshControl = list.props.refreshControl;

    await act(async () => {
      await refreshControl.props.onRefresh();
    });

    expect(listOfflineQueue.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('shows error details when tapping the item', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.press(view.getByText(t('sync.viewError')));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Error del servidor',
      'Fallo de sincronización',
      expect.any(Array),
    );

    alertSpy.mockRestore();
  });
});
