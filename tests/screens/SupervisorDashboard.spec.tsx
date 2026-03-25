import React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupervisorDashboardScreen } from '@/src/screens/SupervisorDashboard';
import type { IceaOpsDashboardData } from '@/src/types/admin';

const mockUseAuth = vi.fn();
const mockUseAdminDashboardData = vi.fn();

vi.mock('@/src/security/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/src/hooks/useAdminDashboardData', () => ({
  useAdminDashboardData: (enabled?: boolean, options?: unknown) => mockUseAdminDashboardData(enabled, options),
}));

function buildDashboardData(overrides: Partial<IceaOpsDashboardData> = {}): IceaOpsDashboardData {
  return {
    summary: {
      generatedAt: '2026-03-08T10:00:00Z',
      available: true,
      enabled: true,
      scope: 'summary',
      state: 'backlog',
      pendingCount: 4,
      flags: { summaryEnabled: true, eventsEnabled: true, bridgeEnabled: true },
      units: [
        {
          unitId: 'icu-a',
          available: true,
          state: 'backlog',
          lastUpdatedAt: '2026-03-08T09:44:00Z',
          pendingCount: 4,
          freshness: {
            lastOutboundAttemptAt: '2026-03-08T09:42:00Z',
            lastOutboundDeliveredAt: '2026-03-08T09:41:00Z',
            lastBridgeUpdatedAt: '2026-03-08T09:44:00Z',
            lastBridgeReceivedAt: '2026-03-08T09:43:00Z',
            lastPipelineEventAt: '2026-03-08T09:45:00Z',
          },
          counts: {
            handoversExported: 8,
            outbox: { total: 8, queued: 1, retry: 1, delivered: 6, failed: 0, retries: 2 },
            bridge: {
              total: 6,
              queued: 0,
              sent: 1,
              accepted: 1,
              pending: 1,
              scored: 3,
              failed: 0,
              stale: 1,
              retries: 1,
              provisional: 2,
              immediate: 4,
              enriched: 2,
              insufficientEvidence: 0,
            },
            pipeline: { snapshots: 8, running: 1, retry: 1, failed: 0, events: 5 },
          },
          latencies: {
            outboxDelivery: { count: 1, avgMs: 900, p95Ms: 900, maxMs: 900, lastMeasuredAt: '2026-03-08T09:41:00Z' },
            bridgeResponse: { count: 1, avgMs: 1200, p95Ms: 1200, maxMs: 1200, lastMeasuredAt: '2026-03-08T09:43:00Z' },
          },
          errors: [{ source: 'outbox', errorFamily: 'timeout', count: 1, lastSeenAt: '2026-03-08T09:42:00Z' }],
          shifts: [{ shift: 'morning', state: 'backlog', pendingCount: 2, lastUpdatedAt: '2026-03-08T09:44:00Z' }],
        },
      ],
    } as unknown as IceaOpsDashboardData['summary'],
    unit: {
      generatedAt: '2026-03-08T10:00:00Z',
      enabled: true,
      scope: 'unit',
      unitId: 'icu-a',
      available: true,
      state: 'backlog',
      lastUpdatedAt: '2026-03-08T09:44:00Z',
      pendingCount: 4,
      freshness: {
        lastOutboundAttemptAt: '2026-03-08T09:42:00Z',
        lastOutboundDeliveredAt: '2026-03-08T09:41:00Z',
        lastBridgeUpdatedAt: '2026-03-08T09:44:00Z',
        lastBridgeReceivedAt: '2026-03-08T09:43:00Z',
        lastPipelineEventAt: '2026-03-08T09:45:00Z',
      },
      counts: {
        handoversExported: 8,
        outbox: { total: 8, queued: 1, retry: 1, delivered: 6, failed: 0, retries: 2 },
        bridge: {
          total: 6,
          queued: 0,
          sent: 1,
          accepted: 1,
          pending: 1,
          scored: 3,
          failed: 0,
          stale: 1,
          retries: 1,
          provisional: 2,
          immediate: 4,
          enriched: 2,
          insufficientEvidence: 0,
        },
        pipeline: { snapshots: 8, running: 1, retry: 1, failed: 0, events: 5 },
      },
      latencies: {
        outboxDelivery: { count: 1, avgMs: 900, p95Ms: 900, maxMs: 900, lastMeasuredAt: '2026-03-08T09:41:00Z' },
        bridgeResponse: { count: 1, avgMs: 1200, p95Ms: 1200, maxMs: 1200, lastMeasuredAt: '2026-03-08T09:43:00Z' },
      },
      errors: [{ source: 'outbox', errorFamily: 'timeout', count: 1, lastSeenAt: '2026-03-08T09:42:00Z' }],
      shifts: [{ shift: 'morning', state: 'backlog', pendingCount: 2, lastUpdatedAt: '2026-03-08T09:44:00Z' }],
      recentEvents: [
        {
          eventId: 'outbox:1',
          source: 'outbox',
          requestId: 'req-1',
          bundleId: 'bundle-1',
          unitId: 'icu-a',
          payloadHash: 'abcd1234',
          status: 'retry',
          statusFamily: null,
          errorFamily: 'timeout',
          attempts: 2,
          httpStatus: null,
          latencyMs: null,
          detail: 'ConnectTimeout',
          createdAt: '2026-03-08T09:45:00Z',
          updatedAt: '2026-03-08T09:45:00Z',
        },
      ],
    },
    events: [],
    ...overrides,
  };
}

describe('SupervisorDashboardScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAdminDashboardData.mockReset();
  });

  it('muestra el panel operativo agregado para la unidad seleccionada', () => {
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

    const screen = render(<SupervisorDashboardScreen />);

    expect(screen.getByTestId('dashboard-ops-panel')).toBeTruthy();
    expect(screen.getByText('Freshness y backlog')).toBeTruthy();
    expect(screen.getByText('Shifts observables')).toBeTruthy();
    expect(screen.getByText('payload_hash: abcd1234')).toBeTruthy();
  });

  it('muestra unavailable explícito si no hay datos utilizables', () => {
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
      data: buildDashboardData({
        unit: {
          ...buildDashboardData().unit!,
          available: false,
          unavailableReason: 'icea_ops_unit_no_data',
        },
      }),
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const screen = render(<SupervisorDashboardScreen />);

    expect(screen.getByText('Unavailable: icea_ops_unit_no_data')).toBeTruthy();
  });

  it('muestra unavailableReason del summary cuando ops esta disabled', () => {
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
      data: buildDashboardData({
        summary: {
          ...buildDashboardData().summary,
          available: false,
          enabled: false,
          state: undefined,
          units: [],
          unavailableReason: 'icea_ops_summary_disabled',
        } as unknown as IceaOpsDashboardData['summary'],
        unit: {
          ...buildDashboardData().unit!,
          available: false,
          enabled: false,
          state: 'degraded',
          unavailableReason: 'icea_ops_unit_disabled',
          recentEvents: [],
          shifts: [],
          errors: [],
        },
      }),
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const screen = render(<SupervisorDashboardScreen />);

    expect(screen.getByText('Observabilidad unavailable: icea_ops_summary_disabled')).toBeTruthy();
    expect(screen.getByText('Unavailable: icea_ops_unit_disabled')).toBeTruthy();
  });

  it('muestra un indicador de carga inicial', () => {
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

  it('renderiza el mensaje de error y permite reintentar', () => {
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
