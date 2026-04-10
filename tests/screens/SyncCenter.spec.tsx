import React from 'react';
import { Alert, FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SyncCenter from '@/src/screens/SyncCenter';
import { t } from '@/src/i18n';

const listOfflineQueue = vi.fn();
const flushSyncQueue = vi.fn();
const getTokenMock = vi.fn(async () => 'token');

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
  NavigationContainer: ({ children }: any) => children,
  useFocusEffect: (cb: any) => cb(),
}));

vi.mock('@/src/lib/queue', () => ({
  listOfflineQueue: (...args: unknown[]) => listOfflineQueue(...args),
}));

vi.mock('@/src/lib/sync', () => ({
  flushSyncQueue: (...args: unknown[]) => flushSyncQueue(...args),
}));

const authModuleMock = {
  getToken: (...args: unknown[]) => getTokenMock(...args),
  default: { getToken: (...args: unknown[]) => getTokenMock(...args) },
};

vi.mock('@/src/services/AuthService', () => authModuleMock);
vi.mock('@/src/security/AuthService', () => authModuleMock);
vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: (...args: unknown[]) => getTokenMock(...args),
}));

vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
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
    errorMessage: 'Fallo de sincronizacion',
    errorStatus: 500,
  },
];

describe('SyncCenter', () => {
  beforeEach(() => {
    listOfflineQueue.mockReset();
    flushSyncQueue.mockReset();
    getTokenMock.mockReset();
    getTokenMock.mockResolvedValue('token');

    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'https://example.test';
    delete process.env.EXPO_PUBLIC_AUTH_TOKEN;

    listOfflineQueue.mockResolvedValue(queueItems);
    flushSyncQueue.mockResolvedValue({ processed: 2, remaining: 0 });
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
      expect(flushSyncQueue).toHaveBeenCalled();
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
      'Fallo de sincronizacion',
      expect.any(Array),
    );

    alertSpy.mockRestore();
  });

  it('ignora EXPO_PUBLIC_AUTH_TOKEN y exige token real de sesion', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    process.env.EXPO_PUBLIC_AUTH_TOKEN = 'public-token';
    getTokenMock.mockResolvedValue(null);
    flushSyncQueue.mockImplementationOnce(async (opts: { getToken: () => Promise<string | null> }) => {
      const token = await opts.getToken();
      return { processed: 0, remaining: 0, outcome: token ? 'success' : 'auth-required' };
    });

    const view = render(<SyncCenter />);
    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(t('sync.syncTitle'), t('sync.authRequiredMessage'));
    alertSpy.mockRestore();
  });
});
