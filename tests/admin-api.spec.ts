import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/src/lib/api', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

import { fetchAdminDashboardData, refreshIceaDashboardSummary } from '@/src/lib/admin-api';

describe('admin-api', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiPost.mockReset();
  });

  it('usa el endpoint ICEA y conserva el contrato nuevo cuando la API responde bien', async () => {
    mockApiGet.mockResolvedValue({
      generatedAt: '2026-03-08T10:00:00Z',
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
          cachedSummary: null,
        },
      ],
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
    expect(result.units[0].unitId).toBe('icu-a');
    expect(result.recentEvents[0].stage).toBe('normalize');
  });

  it('normaliza arrays ausentes para no depender de fixtures viejos', async () => {
    mockApiGet.mockResolvedValue({ generatedAt: '2026-03-08T10:00:00Z' });

    const result = await fetchAdminDashboardData();

    expect(mockApiGet).toHaveBeenCalledWith('/api/icea/dashboard-summary');
    expect(result.generatedAt).toBe('2026-03-08T10:00:00Z');
    expect(result.units).toEqual([]);
    expect(result.recentEvents).toEqual([]);
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
