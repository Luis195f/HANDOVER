import React from 'react';
import { render } from '@testing-library/react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupervisorDashboardScreen } from '@/src/screens/SupervisorDashboard';
import type { IceaDashboardSummary } from '@/src/types/admin';

const mockUseAuth = vi.fn();
const mockUseAdminDashboardData = vi.fn();
const mockApiGet = vi.fn();
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

vi.mock('@/src/security/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/src/hooks/useAdminDashboardData', () => ({
  useAdminDashboardData: (enabled?: boolean, options?: unknown) => mockUseAdminDashboardData(enabled, options),
}));

vi.mock('@/src/lib/api', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/src/lib/priority', () => ({
  computePriorityList: () => [
    {
      patientId: 'pat-1',
      displayName: 'Paciente crítico',
      bedLabel: 'A1',
      news2Score: 7,
      totalScore: 12,
      baseScore: 10,
      level: 'critical',
      baseLevel: 'critical',
      reasons: ['HIGH_NEWS2', 'PENDING_URGENT_TASK'],
      reasonSummary: 'NEWS2 7, 1 pendiente crítico',
      pendingCriticalTasksCount: 1,
      explanation: {
        engine: 'mpac-v1-hybrid-rules',
        version: 1,
        sourceData: ['NEWS2 7 (alto)'],
        clinicalChange: ['Incidente reciente registrado'],
        pendingCritical: ['Gasometría urgente (crítico)'],
        activeContext: {
          unitId: 'icu-a',
          specialtyId: null,
          unitProfileId: null,
          specialtyOverlayIds: [],
          activeProfileIds: [],
          labels: ['HANDOVER Core'],
          usesCoreFallback: true,
          hasHumanSpecialtyOverride: false,
        },
        coreDimensions: [],
        modifiers: [],
      },
    },
  ],
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
        unitId: 'icu-a',
        totalHandovers: 10,
        accepted: 1,
        queued: 1,
        running: 1,
        delivered: 2,
        succeeded: 5,
        retry: 1,
        failed: 0,
        lastUpdatedAt: '2026-03-08T09:00:00Z',
        lastDashboardRefreshAt: '2026-03-08T09:30:00Z',
        cachedSummary: null,
        activity: { status: 'active', handoversLast24h: 5, eventsLast24h: 7, activePipeline: 2, lastActivityAt: '2026-03-08T09:45:00Z' },
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
        handoverTiming: [{ unitId: 'icu-a', sectionId: 'sbar', avgDurationMs: 1500, samples: 5 }],
        alertsOpen: 1,
        degraded: false,
        degradationReasons: [],
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        unitId: 'icu-a',
        source: 'pipeline',
        severity: 'medium',
        status: 'retry',
        title: 'Pipeline ICEA degradado',
        message: 'detalle',
        requestId: 'req-1',
        createdAt: '2026-03-08T09:40:00Z',
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
      running: 1,
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
        unitId: 'icu-a',
        stage: 'normalize',
        action: 'normalize',
        status: 'running',
        source: 'manual-action',
        actorSub: 'auth0|sup-1',
        detail: null,
        httpStatus: 200,
        payload: null,
        createdAt: '2026-03-08T09:45:00Z',
      },
    ],
    ...overrides,
  };
}

describe('SupervisorDashboardScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAdminDashboardData.mockReset();
    mockApiGet.mockReset();
  });

  it('muestra prioridad contextual para supervisor usando el censo real de la unidad', async () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'sup-1',
        roles: ['supervisor'],
        units: ['icu-a'],
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
    mockApiGet.mockResolvedValue([
      {
        id: 'pat-1',
        name: 'Paciente crítico',
        unitId: 'icu-a',
        bedLabel: 'A1',
        pendingTasks: [
          {
            id: 'task-1',
            title: 'Gasometría urgente',
            critical: true,
            dueBy: '2026-03-19T10:45:00.000Z',
          },
        ],
      },
    ]);

    const screen = render(<SupervisorDashboardScreen />);

    await act(async () => {
      await flush();
      await flush();
    });

    expect(screen.getByTestId('dashboard-priority-panel')).toBeTruthy();
    expect(screen.getByText('Prioridad contextual')).toBeTruthy();
    expect(screen.getByText('Paciente crítico')).toBeTruthy();
    expect(screen.getByText('Riesgo de omisión alto')).toBeTruthy();
    expect(screen.getByText('No omitir: Gasometría urgente')).toBeTruthy();
  });


  it('degrada con mensaje no bloqueante si falla el censo de pacientes de la unidad', async () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'sup-1',
        roles: ['supervisor'],
        units: ['icu-a'],
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
    mockApiGet.mockRejectedValue(new Error('boom'));

    const screen = render(<SupervisorDashboardScreen />);

    await act(async () => {
      await flush();
      await flush();
    });

    expect(screen.getByTestId('dashboard-priority-panel')).toBeTruthy();
    expect(
      screen.getByText('No se pudo calcular la prioridad contextual con el censo actual de la unidad.'),
    ).toBeTruthy();
    expect(screen.getByText('Estado operativo')).toBeTruthy();
  });
  it('muestra un indicador de carga inicial', async () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'sup-1',
        roles: ['supervisor'],
        units: ['icu-a'],
        accessToken: 'token',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: null,
    });

    const { getByTestId } = render(<SupervisorDashboardScreen />);

    expect(getByTestId('dashboard-loader')).toBeTruthy();
  });

  it('renderiza el mensaje de error y permite reintentar', async () => {
    mockUseAuth.mockReturnValue({
      session: {
        userId: 'sup-1',
        roles: ['supervisor'],
        units: ['icu-a'],
        accessToken: 'token',
      },
      loading: false,
    });
    mockUseAdminDashboardData.mockReturnValue({
      data: null,
      loading: false,
      error: new Error('boom'),
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: null,
    });

    const { getByTestId } = render(<SupervisorDashboardScreen />);

    expect(getByTestId('dashboard-error')).toBeTruthy();
  });
});




