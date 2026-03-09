import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/src/lib/api', () => ({
  ApiClientError: class MockApiClientError extends Error {
    status: number;
    details: string;
    constructor(status: number, details = '') {
      super(`API request failed (${status})`);
      this.status = status;
      this.details = details;
    }
  },
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

import { AdminDashboardApiError, fetchAdminDashboardData, refreshIceaDashboardSummary } from '@/src/lib/admin-api';

describe('admin-api', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiPost.mockReset();
  });

  it('usa el endpoint ICEA real y conserva el contrato enriquecido', async () => {
    mockApiGet.mockResolvedValue({
      generatedAt: '2026-03-08T10:00:00Z',
      source: 'live',
      demoMode: false,
      empty: false,
      stale: false,
      degraded: true,
      degradationReasons: ['outbox_failed'],
      latestActivityAt: '2026-03-08T09:45:00Z',
      units: [
        {
          unitId: 'icu-a',
          totalHandovers: 8,
          accepted: 1,
          queued: 1,
          running: 1,
          delivered: 2,
          succeeded: 2,
          retry: 1,
          failed: 0,
          lastUpdatedAt: '2026-03-08T09:00:00Z',
          lastDashboardRefreshAt: '2026-03-08T09:30:00Z',
          activity: { status: 'active', handoversLast24h: 4, eventsLast24h: 5, activePipeline: 2, lastActivityAt: '2026-03-08T09:45:00Z' },
          outbox: { total: 8, queued: 1, retry: 0, delivered: 7, failed: 0, lastAttemptAt: null, lastDeliveredAt: null },
          bridge: {
            total: 6,
            queued: 0,
            sent: 0,
            accepted: 1,
            pending: 1,
            scored: 4,
            failed: 0,
            stale: 0,
            provisional: 2,
            insufficientEvidence: 0,
            lastUpdatedAt: null,
          },
          handoverTiming: [{ unitId: 'icu-a', sectionId: 'sbar', avgDurationMs: 1200, samples: 4 }],
          alertsOpen: 1,
          degraded: false,
          degradationReasons: [],
        },
      ],
      alerts: [
        {
          id: 'alert-1',
          unitId: 'icu-a',
          source: 'outbox',
          severity: 'high',
          status: 'failed',
          title: 'Entrega ICEA con incidencia',
          message: 'detalle',
          requestId: 'req-1',
          createdAt: '2026-03-08T09:40:00Z',
        },
      ],
      outbox: {
        enabled: true,
        configured: true,
        totals: { queued: 1, retry: 0, delivered: 7, failed: 0 },
        lastAttemptAt: null,
        lastDeliveredAt: null,
      },
      pipeline: {
        configured: true,
        remoteActionsEnabled: true,
        remoteStatusEnabled: true,
        bridgeEnabled: true,
        bridgeConfigured: true,
        snapshots: 8,
        running: 1,
        retry: 1,
        failed: 0,
        bridge: { queued: 0, sent: 0, accepted: 1, pending: 1, scored: 4, failed: 0, stale: 0, provisional: 2, insufficientEvidence: 0 },
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
          actorSub: 'auth0|admin-1',
          detail: null,
          httpStatus: 200,
          payload: null,
          createdAt: '2026-03-08T09:45:00Z',
        },
      ],
    });

    const result = await fetchAdminDashboardData('icu-a');

    expect(mockApiGet).toHaveBeenCalledWith('/api/icea/dashboard-summary?unitId=icu-a');
    expect(result.units[0].activity.status).toBe('active');
    expect(result.alerts[0].source).toBe('outbox');
    expect(result.pipeline.snapshots).toBe(8);
  });

  it('usa fixtures solo en demo mode explicito', async () => {
    mockApiGet.mockResolvedValue({ mode: 'demo' });

    const result = await fetchAdminDashboardData(undefined, { demoMode: true });

    expect(result.demoMode).toBe(true);
    expect(result.source).toBe('demo');
    expect(result.units.length).toBeGreaterThan(0);
  });

  it('expone errores tipados cuando el backend falla', async () => {
    mockApiGet.mockRejectedValue(new (await import('@/src/lib/api')).ApiClientError(503, 'upstream down'));

    await expect(fetchAdminDashboardData()).rejects.toBeInstanceOf(AdminDashboardApiError);
    await expect(fetchAdminDashboardData()).rejects.toMatchObject({ code: 'remote', status: 503 });
  });

  it('refresca dashboard summary via backend HANDOVER', async () => {
    mockApiPost.mockResolvedValue({
      action: 'refresh-dashboard-summary',
      result: { statusCode: 200, payload: { status: 'completed' } },
    });

    const result = await refreshIceaDashboardSummary('icu-a');

    expect(mockApiPost).toHaveBeenCalledWith('/api/icea/actions/refresh-dashboard-summary', {
      body: JSON.stringify({ unitId: 'icu-a' }),
    });
    expect(result.action).toBe('refresh-dashboard-summary');
    expect(result.result.statusCode).toBe(200);
  });
});
