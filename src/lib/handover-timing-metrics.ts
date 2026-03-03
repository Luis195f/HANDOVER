import { apiGet, apiPost } from '@/src/lib/api';

export type HandoverTimingSectionId = 'sbar' | 'vitals' | 'diagnostics' | 'treatments';

export interface HandoverTimingMetricInput {
  sectionId: HandoverTimingSectionId;
  durationMs: number;
  unitId?: string;
  requestId?: string;
}

export interface HandoverTimingAggregate {
  unitId: string;
  sectionId: HandoverTimingSectionId;
  avgDurationMs: number;
  samples: number;
}

export async function postHandoverTimingMetric(input: HandoverTimingMetricInput) {
  return apiPost('/metrics/handover-time', {
    body: JSON.stringify(input),
  });
}

export async function getHandoverTimingAggregates(unitId?: string) {
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  return apiGet(`/metrics/handover-time${qs}`) as Promise<{ results: HandoverTimingAggregate[] }>;
}
