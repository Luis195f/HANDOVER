import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import type { ClinicalDecisionGovernanceSummary, IceaOpsDashboardData } from '@/src/types/admin';

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
      empty: false,
      state: 'degraded',
      lastUpdatedAt: '2026-03-08T09:45:00Z',
      pendingCount: 4,
      flags: { summaryEnabled: true, eventsEnabled: true, bridgeEnabled: true, remoteActionsEnabled: true },
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
          stale: 0,
          retries: 1,
          provisional: 2,
          immediate: 4,
          enriched: 2,
          insufficientEvidence: 0,
        },
        pipeline: { snapshots: 8, running: 1, retry: 1, failed: 0, events: 5 },
      } as unknown as IceaOpsDashboardData['summary']['counts'],
      latencies: {
        outboxDelivery: { count: 1, avgMs: 900, p95Ms: 900, maxMs: 900, lastMeasuredAt: '2026-03-08T09:41:00Z' },
        bridgeResponse: { count: 1, avgMs: 1200, p95Ms: 1200, maxMs: 1200, lastMeasuredAt: '2026-03-08T09:43:00Z' },
      },
      errors: [{ source: 'outbox', errorFamily: 'timeout', count: 1, lastSeenAt: '2026-03-08T09:42:00Z' }],
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
              stale: 0,
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
          errors: [],
          shifts: [{ shift: 'morning', state: 'backlog', pendingCount: 2, lastUpdatedAt: '2026-03-08T09:44:00Z' }],
        },
      ],
    } as unknown as IceaOpsDashboardData['summary'],
    unit: null,
    events: [
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
    ...overrides,
  };
}

function buildClinicalDecisionSummary(
  overrides: Partial<ClinicalDecisionGovernanceSummary> = {},
): ClinicalDecisionGovernanceSummary {
  return {
    generatedAt: '2026-03-28T10:00:00Z',
    available: true,
    enabled: true,
    scope: 'clinical_decisions_summary',
    filters: {
      unitId: 'icu-a',
      suggestionSource: 'ai_nic_suggestions',
      decision: null,
      section: 'treatments',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-28',
    },
    queryBounds: {
      createdAtGte: '2026-03-01T00:00:00+00:00',
      createdAtLt: '2026-03-29T00:00:00+00:00',
    },
    empty: false,
    feature: {
      key: 'admin_analytics',
      mode: 'enabled',
      pilotMode: 'pilot',
      shadowMode: false,
    },
    totals: {
      events: 5,
      units: 1,
      suggestionSources: 1,
      sections: 1,
    },
    byDecision: [
      { decision: 'applied', count: 3 },
      { decision: 'dismissed', count: 2 },
    ],
    byUnit: [{ unitId: 'icu-a', count: 5 }],
    bySuggestionSource: [
      {
        suggestionSource: 'ai_nic_suggestions',
        count: 5,
        decisions: { accepted: 0, applied: 3, rejected: 0, dismissed: 2 },
      },
    ],
    bySection: [
      {
        section: 'treatments',
        count: 5,
        decisions: { accepted: 0, applied: 3, rejected: 0, dismissed: 2 },
      },
    ],
    timeline: [
      {
        date: '2026-03-28',
        count: 2,
        decisions: { accepted: 0, applied: 1, rejected: 0, dismissed: 1 },
      },
    ],
    limitations: ['Lectura agregada y piloto-grade; no expone identificadores nominales ni admite benchmarking individual.'],
    ...overrides,
  };
}

describe('AdminDashboardScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAdminDashboardData.mockReset();
  });

  it('muestra el resumen operativo cuando el usuario es admin', () => {
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
      data: { ...buildDashboardData(), clinicalDecisionSummary: buildClinicalDecisionSummary() },
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText('Observabilidad operativa ICEA+')).toBeTruthy();
    expect(getByText('Gobernanza de decisiones IA')).toBeTruthy();
    expect(getByText(/no punitiva/)).toBeTruthy();
    expect(getByText('Sugerencias NIC')).toBeTruthy();
    expect(getByText('icu-a')).toBeTruthy();
    expect(getByText(/hasta .*28.*2026/)).toBeTruthy();
    expect(getByText(/Familias de error/)).toBeTruthy();
    expect(getByText(/payload_hash: abcd1234/)).toBeTruthy();
    expect(getByText(/no expone identificadores nominales/i)).toBeTruthy();
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
      data: {
        ...buildDashboardData({
          summary: {
            ...buildDashboardData().summary,
            empty: true,
            units: [],
            errors: [],
          },
          events: [],
        }),
        clinicalDecisionSummary: buildClinicalDecisionSummary({
          empty: true,
          byUnit: [],
          bySection: [],
          bySuggestionSource: [],
          byDecision: [],
          timeline: [],
        }),
      },
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(getByText(/Todavía no hay datos operativos reales para mostrar/)).toBeTruthy();
    expect(getByText(/No hay decisiones IA registradas para este corte/)).toBeTruthy();
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

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(
      false,
      expect.objectContaining({
        demoMode: false,
        includeClinicalDecisionSummary: true,
      }),
    );
    expect(getByText(/Acceso restringido/)).toBeTruthy();
  });

  it('etiqueta demo, stale y unavailable de forma explicita', () => {
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
      data: {
        ...buildDashboardData({
          summary: {
            ...buildDashboardData().summary,
            available: false,
            unavailableReason: 'icea_ops_summary_disabled',
          } as unknown as IceaOpsDashboardData['summary'],
        }),
        clinicalDecisionSummary: buildClinicalDecisionSummary({
          available: false,
          enabled: false,
          empty: true,
          unavailableReason: 'unit_out_of_scope',
        }),
      },
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: true,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByText } = render(<AdminDashboardScreen />);

    expect(mockUseAdminDashboardData).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        demoMode: true,
        includeClinicalDecisionSummary: true,
      }),
    );
    expect(getByText(/Modo demo explícito/)).toBeTruthy();
    expect(getByText(/puede estar stale/)).toBeTruthy();
    expect(getByText(/Observabilidad unavailable/)).toBeTruthy();
    expect(getByText(/icea_ops_summary_disabled/)).toBeTruthy();
    expect(getByText(/Gobernanza unavailable/)).toBeTruthy();
    expect(getByText(/unit_out_of_scope/)).toBeTruthy();
  });

  it('aplica filtros agregados sin exponer ejes nominales', () => {
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
      data: { ...buildDashboardData(), clinicalDecisionSummary: buildClinicalDecisionSummary() },
      loading: false,
      error: null,
      reload: vi.fn(),
      refreshRemoteSummary: vi.fn(),
      refreshingUnitId: null,
      stale: false,
      lastLoadedAt: '2026-03-08T10:00:00Z',
    });

    const { getByTestId, queryByText } = render(<AdminDashboardScreen />);

    fireEvent.changeText(getByTestId('clinical-governance-unit-input'), 'icu-a');
    fireEvent.changeText(getByTestId('clinical-governance-date-from-input'), '2026-03-01');
    fireEvent.press(getByTestId('clinical-governance-apply-filters'));

    expect(mockUseAdminDashboardData).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        includeClinicalDecisionSummary: true,
        clinicalDecisionFilters: expect.objectContaining({
          unitId: 'icu-a',
          dateFrom: '2026-03-01',
        }),
      }),
    );
    expect(queryByText(/auth0\|/i)).toBeNull();
  });
});
