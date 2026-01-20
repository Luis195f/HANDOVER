import React from 'react';
import { Alert, FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SyncCenter from '@/src/screens/SyncCenter';

const listOfflineQueue = vi.fn();
const flushQueueNow = vi.fn();

vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/src/lib/queue', () => ({ listOfflineQueue: (...args: unknown[]) => listOfflineQueue(...args) }));
vi.mock('@/src/lib/sync/index', () => ({ flushQueueNow: (...args: unknown[]) => flushQueueNow(...args) }));
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
    flushQueueNow.mockReset();
    process.env.EXPO_PUBLIC_FHIR_BASE = 'https://example.test';
    process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'https://example.test';
    process.env.EXPO_PUBLIC_AUTH_TOKEN = 'token';
    listOfflineQueue.mockResolvedValue(queueItems);
    flushQueueNow.mockResolvedValue({ processed: 2, remaining: 0 });
  });

  it('muestra los elementos de la cola con estados esperados', async () => {
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    expect(view.getByText('Sync Center')).toBeTruthy();
    expect(view.getByTestId('sync-flush')).toBeTruthy();
    expect(view.getByTestId('sync-item-pending-1')).toBeTruthy();
    expect(view.getByTestId('sync-item-error-1')).toBeTruthy();
    expect(view.getByText('Intentos: 1')).toBeTruthy();
    expect(view.getByText('Intentos: 2')).toBeTruthy();
    expect(view.getByText('PENDING')).toBeTruthy();
    expect(view.getByText('Error del servidor')).toBeTruthy();
    expect(view.getByText('Ver error')).toBeTruthy();
    expect(view.getByText('Error')).toBeTruthy();
  });

  it('dispara el reintento y recarga la cola', async () => {
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    const initialCalls = listOfflineQueue.mock.calls.length;

    await act(async () => {
      fireEvent.press(view.getByTestId('sync-flush'));
    });

    await waitFor(() => {
      expect(flushQueueNow).toHaveBeenCalled();
    });

    expect(listOfflineQueue.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('permite refrescar la lista', async () => {
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

  it('muestra el detalle del error al pulsar el ítem', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = render(<SyncCenter />);

    await waitFor(() => {
      expect(listOfflineQueue).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Ver error'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Error del servidor',
      'Fallo de sincronización',
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });
});
