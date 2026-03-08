import React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import type { IceaDashboardSummary } from '@/src/types/admin';

const mockUseAuth = vi.fn();
const mockUseAdminDashboardData = vi.fn();

vi.mock('@/src/security/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/src/hooks/useAdminDashboardData', () => ({
  useAdminDashboardData: (enabled?: boolean) => mockUseAdminDashboardData(enabled),
}));

function buildDashboardData(overrides: Partial<IceaDashboardSummary> = {}): IceaDashboardSummary {
  return {
    generatedAt: '2026-03-08T10:00:00Z',
    units: [
      {
        unitId: 'icu',
        totalHandovers: 10,
        accepted: 1,
        queued: 1,
        running: 2,
        delivered: 2,
        succeeded: 3,
        retry: 1,
        failed: 0,
        lastUpdatedAt: '2026-03-08T09:00:00Z',
        lastDashboardRefreshAt: '2026-03-08T09:30:00Z',
        cachedSummary: null,
      },
    ],
    recentEvents: [
      {
        id: 1,
        requestId: 'req-1',
        bundleId: 'bundle-1',
        patientId: 'pat-1',
        unitId: 'icu',
        stage: 'normalize',
        action: 'normalize',
        status: 'running',
        source: 'manual-action',
        actorSub: 'auth0|admin-1',
        detail: null,
        httpStatus: 200,
        payload: null,
        createdAt: '2026-03-08T09:45:00Z',
      },
    ],
    ...overrides,
  };
}

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAdminDashboardData.mockReset();
  });

  it('muestra datos cuando el usuario es admin', () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'admin-1',
        roles: ['admin'],
        units: [],
        accessToken: 'token',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: buildDashboardData(),
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText('Orquestación ICEA+')).toBeTruthy();
    expect(getByText('icu')).toBeTruthy();
    expect(getByText(/normalize/)).toBeTruthy();
  });

  it('restringe acceso a usuarios no admin ni supervisor', () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'nurse-1',
        roles: ['nurse'],
        units: [],
        accessToken: 'token',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(false);
    expect(getByText(/Acceso restringido/)).toBeTruthy();
  });

  it('tolera datos parciales para supervisor sin explotar', () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'supervisor-1',
        roles: ['supervisor'],
        units: [],
        accessToken: 'token',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: {
        generatedAt: '',
        units: undefined,
        recentEvents: undefined,
      },
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(true);
    expect(getByText('Orquestación ICEA+')).toBeTruthy();
    expect(getByText(/Sin datos/)).toBeTruthy();
  });
});
