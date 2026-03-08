import { apiGet, apiPost } from '@/src/lib/api';
import type { IceaDashboardSummary } from '@/src/types/admin';

export async function fetchAdminDashboardData(unitId?: string): Promise<IceaDashboardSummary> {
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  return apiGet(`/api/icea/dashboard-summary${qs}`) as Promise<IceaDashboardSummary>;
}

export async function refreshIceaDashboardSummary(unitId: string) {
  return apiPost('/api/icea/actions/refresh-dashboard-summary', {
    body: JSON.stringify({ unitId }),
  }) as Promise<{
    action: string;
    result: { statusCode: number; payload?: Record<string, unknown> | null };
  }>;
}
