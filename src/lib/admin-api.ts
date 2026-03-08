import { apiGet, apiPost } from '@/src/lib/api';
import type { IceaDashboardSummary } from '@/src/types/admin';

export type AdminDashboardData = IceaDashboardSummary;

function normalizeDashboardSummary(payload: Partial<IceaDashboardSummary> | null | undefined): IceaDashboardSummary {
  return {
    generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : '',
    units: Array.isArray(payload?.units) ? payload.units : [],
    recentEvents: Array.isArray(payload?.recentEvents) ? payload.recentEvents : [],
  };
}

export async function fetchAdminDashboardData(unitId?: string): Promise<IceaDashboardSummary> {
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  const response = (await apiGet(`/api/icea/dashboard-summary${qs}`)) as Partial<IceaDashboardSummary> | null | undefined;
  return normalizeDashboardSummary(response);
}

export async function refreshIceaDashboardSummary(unitId: string) {
  return apiPost('/api/icea/actions/refresh-dashboard-summary', {
    body: JSON.stringify({ unitId }),
  }) as Promise<{
    action: string;
    result: { statusCode: number; payload?: Record<string, unknown> | null };
  }>;
}
