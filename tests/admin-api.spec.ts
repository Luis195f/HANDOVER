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

function buildSummaryPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-03-08T10:00:00Z',
    available: true,
    enabled: true,
    scope: 'summary',
    state: 'degraded',
    pendingCount: 4,
    flags: { summaryEnabled: true, eventsEnabled: true, bridgeEnabled: true },
    units: [
      {
        unitId: 'icu-a',
        available: true,
        state: 'backlog',
        pendingCount: 4,
        freshness: {},
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
        latencies: {},
        errors: [],
        shifts: [],
      },
    ],
    errors: [],
    ...overrides,
  };
}

function buildEventsPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-03-08T10:00:00Z',
    available: true,
    enabled: true,
    scope: 'events',
    count: 1,
    results: [
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

function buildUnitPayload(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-03-08T10:00:00Z',
    enabled: true,
    scope: 'unit',
    unitId: 'icu-a',
    available: true,
    state: 'backlog',
    pendingCount: 4,
    freshness: {},
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
    latencies: {},
    errors: [],
    shifts: [],
    recentEvents: [],
    ...overrides,
  };
}

describe('admin-api', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiPost.mockReset();
  });

  it('usa los endpoints ops reales del backend HANDOVER', async () => {
    mockApiGet
      .mockResolvedValueOnce(buildSummaryPayload())
      .mockResolvedValueOnce(buildEventsPayload())
      .mockResolvedValueOnce(
        buildUnitPayload({
          shifts: [{ shift: 'morning', state: 'backlog', pendingCount: 2, lastUpdatedAt: '2026-03-08T09:40:00Z' }],
        }),
      );

    const result = await fetchAdminDashboardData('icu-a');

    expect(mockApiGet).toHaveBeenNthCalledWith(1, '/api/icea/ops/summary');
    expect(mockApiGet).toHaveBeenNthCalledWith(2, '/api/icea/ops/events?unitId=icu-a');
    expect(mockApiGet).toHaveBeenNthCalledWith(3, '/api/icea/ops/unit/icu-a');
    expect(result.summary.state).toBe('degraded');
    expect(result.unit?.unitId).toBe('icu-a');
    expect(result.events[0].payloadHash).toBe('abcd1234');
  });

  it('acepta summary disabled y mantiene events habilitados sin invalid_payload', async () => {
    mockApiGet
      .mockResolvedValueOnce(
        buildSummaryPayload({
          available: false,
          enabled: false,
          state: undefined,
          empty: true,
          pendingCount: 0,
          units: [],
          errors: [],
          unavailableReason: 'icea_ops_summary_disabled',
        }),
      )
      .mockResolvedValueOnce(buildEventsPayload())
      .mockResolvedValueOnce(
        buildUnitPayload({
          available: false,
          enabled: false,
          state: 'degraded',
          pendingCount: 0,
          errors: [],
          shifts: [],
          recentEvents: [],
          unavailableReason: 'icea_ops_unit_disabled',
        }),
      );

    const result = await fetchAdminDashboardData('icu-a');

    expect(result.summary.available).toBe(false);
    expect(result.summary.unavailableReason).toBe('icea_ops_summary_disabled');
    expect(result.summary.units).toEqual([]);
    expect(result.events).toHaveLength(1);
  });

  it('acepta events disabled y mantiene summary habilitado sin invalid_payload', async () => {
    mockApiGet
      .mockResolvedValueOnce(buildSummaryPayload())
      .mockResolvedValueOnce(
        buildEventsPayload({
          available: false,
          enabled: false,
          count: 0,
          results: [],
          unavailableReason: 'icea_ops_events_disabled',
        }),
      )
      .mockResolvedValueOnce(buildUnitPayload());

    const result = await fetchAdminDashboardData('icu-a');

    expect(result.summary.available).toBe(true);
    expect(result.events).toEqual([]);
    expect(mockApiGet).toHaveBeenNthCalledWith(2, '/api/icea/ops/events?unitId=icu-a');
  });

  it('acepta unit unavailable sin datos y evita estado healthy falso', async () => {
    mockApiGet
      .mockResolvedValueOnce(buildSummaryPayload({ empty: true, units: [] }))
      .mockResolvedValueOnce(buildEventsPayload({ count: 0, results: [] }))
      .mockResolvedValueOnce(
        buildUnitPayload({
          unitId: 'ward-z',
          available: false,
          state: undefined,
          pendingCount: 0,
          errors: [],
          shifts: [],
          recentEvents: [],
          unavailableReason: 'icea_ops_unit_no_data',
        }),
      );

    const result = await fetchAdminDashboardData('ward-z');

    expect(result.unit?.available).toBe(false);
    expect(result.unit?.state).toBe('degraded');
    expect(result.unit?.unavailableReason).toBe('icea_ops_unit_no_data');
  });

  it('acepta summary vacio pero valido con arrays vacios', async () => {
    mockApiGet
      .mockResolvedValueOnce(buildSummaryPayload({ empty: true, state: 'healthy', pendingCount: 0, units: [], errors: [] }))
      .mockResolvedValueOnce(buildEventsPayload({ count: 0, results: [] }))
      .mockResolvedValueOnce(null);

    const result = await fetchAdminDashboardData();

    expect(result.summary.empty).toBe(true);
    expect(result.summary.units).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('acepta payload unavailable con available=false, enabled=false y arrays vacios', async () => {
    mockApiGet
      .mockResolvedValueOnce(
        buildSummaryPayload({
          available: false,
          enabled: false,
          state: undefined,
          empty: true,
          pendingCount: 0,
          units: [],
          errors: [],
          unavailableReason: 'icea_ops_summary_disabled',
        }),
      )
      .mockResolvedValueOnce(
        buildEventsPayload({
          available: false,
          enabled: false,
          count: 0,
          results: [],
          unavailableReason: 'icea_ops_events_disabled',
        }),
      )
      .mockResolvedValueOnce(
        buildUnitPayload({
          available: false,
          enabled: false,
          state: 'degraded',
          pendingCount: 0,
          errors: [],
          shifts: [],
          recentEvents: [],
          unavailableReason: 'icea_ops_unit_disabled',
        }),
      );

    await expect(fetchAdminDashboardData('icu-a')).resolves.toMatchObject({
      summary: {
        available: false,
        enabled: false,
        unavailableReason: 'icea_ops_summary_disabled',
      },
      events: [],
      unit: {
        available: false,
        enabled: false,
        unavailableReason: 'icea_ops_unit_disabled',
      },
    });
  });

  it('usa fixtures solo en demo mode explicito', async () => {
    mockApiGet.mockResolvedValue({ mode: 'demo' });

    const result = await fetchAdminDashboardData(undefined, { demoMode: true });

    expect(result.summary.available).toBe(true);
    expect(result.summary.units.length).toBeGreaterThan(0);
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
