import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import type { AdminDashboardData } from '@/src/lib/admin-api';

const mockUseAuth = vi.fn();
const mockUseAdminDashboardData = vi.fn();

vi.mock('@/src/security/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/src/hooks/useAdminDashboardData', () => ({
  useAdminDashboardData: (enabled?: boolean) => mockUseAdminDashboardData(enabled),
}));

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAdminDashboardData.mockReset();
  });

  it('muestra datos cuando el usuario es admin', () => {
    const data: AdminDashboardData = {
      units: [
        {
          unitId: 'icu',
          unitName: 'UCI',
          totalHandovers: 10,
          completedHandovers: 9,
          pendingHandovers: 1,
          criticalPatients: 2,
        },
      ],
      staff: [],
      alerts: [],
    };

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
      data,
      loading: false,
      error: null,
      reload: vi.fn(),
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText('Dashboard administrativo')).toBeTruthy();
    expect(getByText('UCI')).toBeTruthy();
  });

  it('restringe acceso a usuarios no admin', () => {
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
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(false);
    expect(getByText(/Acceso restringido/)).toBeTruthy();
  });

  it('permite acceso a supervisor', () => {
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
      data: { units: [], staff: [], alerts: [] },
      loading: false,
      error: null,
      reload: vi.fn(),
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(true);
    expect(getByText('Dashboard administrativo')).toBeTruthy();
  });
});
