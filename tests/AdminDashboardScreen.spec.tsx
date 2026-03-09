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
  useAdminDashboardData: (enabled?: boolean, options?: unknown) => mockUseAdminDashboardData(enabled, options),
}));

function buildDashboardData(overrides: Partial<IceaDashboardSummary> = {}): IceaDashboardSummary {
  return {
    generatedAt: '2026-03-08T10:00:00Z',
    source: 'live',
    demoMode: false,
    empty: false,
    stale: false,
    degraded: false,
    degradationReasons: [],
    latestActivityAt: '2026-03-08T09:45:00Z',
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
        activity: { status: 'active', handoversLast24h: 4, eventsLast24h: 6, activePipeline: 3, lastActivityAt: '2026-03-08T09:45:00Z' },
        outbox: { total: 10, queued: 1, retry: 0, delivered: 9, failed: 0, lastAttemptAt: null, lastDeliveredAt: null },
        bridge: {
          total: 8,
          queued: 0,
          sent: 0,
          accepted: 1,
          pending: 1,
          scored: 6,
          failed: 0,
          stale: 0,
          provisional: 2,
          insufficientEvidence: 0,
          lastUpdatedAt: null,
        },
        handoverTiming: [{ unitId: 'icu', sectionId: 'sbar', avgDurationMs: 1200, samples: 4 }],
        alertsOpen: 1,
        degraded: false,
        degradationReasons: [],
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        unitId: 'icu',
        source: 'outbox',
        severity: 'high',
        status: 'failed',
        title: 'Entrega ICEA con incidencia',
        message: 'detalle',
        requestId: 'req-1',
        createdAt: '2026-03-08T09:44:00Z',
      },
    ],
    outbox: {
      enabled: true,
      configured: true,
      totals: { queued: 1, retry: 0, delivered: 9, failed: 0 },
      lastAttemptAt: null,
      lastDeliveredAt: null,
    },
    pipeline: {
      configured: true,
      remoteActionsEnabled: true,
      remoteStatusEnabled: true,
      bridgeEnabled: true,
      bridgeConfigured: true,
      snapshots: 10,
      running: 2,
      retry: 1,
      failed: 0,
      bridge: { queued: 0, sent: 0, accepted: 1, pending: 1, scored: 6, failed: 0, stale: 0, provisional: 2, insufficientEvidence: 0 },
      lastEventAt: '2026-03-08T09:45:00Z',
      degradationReasons: [],
    },
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

  it('muestra el resumen backend-driven cuando el usuario es admin', () => {
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
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText('Dashboard admin ICEA+')).toBeTruthy();
    expect(getByText('icu')).toBeTruthy();
    expect(getByText(/Alertas e incidencias/)).toBeTruthy();
    expect(getByText(/normalize/)).toBeTruthy();
  });

  it('muestra empty state honesto cuando no hay datos reales', () => {
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
      data: buildDashboardData({ empty: true, units: [], alerts: [], recentEvents: [] }),
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText(/Todavia no hay datos operativos para mostrar/)).toBeTruthy();
    expect(getByText(/Sin unidades con actividad real/)).toBeTruthy();
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
      stale: false,
      lastLoadedAt: null,
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(false, { demoMode: false });
    expect(getByText(/Acceso restringido/)).toBeTruthy();
  });

  it('etiqueta demo y estado degradado de forma explicita', () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'supervisor-1',
        roles: ['supervisor'],
        units: [],
        accessToken: 'token',
        mode: 'demo',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: buildDashboardData({ demoMode: true, source: 'demo', degraded: true, degradationReasons: ['bridge_stale'] }),
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: true,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(true, { demoMode: true });
    expect(getByText(/Modo demo explicito/)).toBeTruthy();
    expect(getByText(/Estado degradado/)).toBeTruthy();
  });
});
