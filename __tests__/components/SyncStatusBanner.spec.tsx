import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import SyncStatusBanner from '@/src/components/SyncStatusBanner';

let currentSnapshot = {
  status: 'running' as const,
  lastRunAt: null,
  pendingCount: 2,
  lastError: null,
  nextRetryAt: null,
};

vi.mock('@/src/lib/sync', () => ({
  getSyncSnapshot: vi.fn(() => currentSnapshot),
  subscribeSyncStatus: vi.fn((listener: (snapshot: typeof currentSnapshot) => void) => {
    listener(currentSnapshot);
    return () => {};
  }),
}));

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

describe('SyncStatusBanner', () => {
  it('muestra el estado de sincronización en curso', () => {
    currentSnapshot = {
      status: 'running',
      lastRunAt: null,
      pendingCount: 2,
      lastError: null,
      nextRetryAt: null,
    };
    const { getByText } = render(<SyncStatusBanner />);
    expect(getByText('Sincronizando… 2 pendientes')).toBeTruthy();
  });

  it('muestra CTA de inicio de sesión cuando está pausado', () => {
    currentSnapshot = {
      status: 'paused',
      lastRunAt: null,
      pendingCount: 0,
      lastError: 'Autenticación requerida',
      nextRetryAt: null,
    };
    const { getByText } = render(<SyncStatusBanner />);
    expect(getByText('Iniciar sesión')).toBeTruthy();
  });
});
