import { useEffect, useState } from 'react';

import { fetchIceaPatientRiskSummaries } from '@/src/lib/icea-bridge-api';
import type { IceaPatientRiskListResponse, IceaPatientRiskSummary } from '@/src/types/icea';

export function useIceaPatientRiskSummaries(enabled = true, filters?: { patientId?: string; unitId?: string; limit?: number }) {
  const [data, setData] = useState<IceaPatientRiskListResponse>({ enabled, results: [], count: 0 });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData({ enabled: false, results: [], count: 0 });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIceaPatientRiskSummaries(filters)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err as Error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, filters?.patientId, filters?.unitId, filters?.limit]);

  return { data, loading, error };
}

export function useIceaPatientRisk(patientId?: string, options?: { unitId?: string; enabled?: boolean }) {
  const enabled = Boolean(options?.enabled && patientId);
  const { data, loading, error } = useIceaPatientRiskSummaries(enabled, {
    patientId,
    unitId: options?.unitId,
    limit: 1,
  });
  const summary: IceaPatientRiskSummary | null = data.results[0] ?? null;
  return {
    summary,
    loading,
    error,
    empty: !loading && !error && data.count === 0,
  };
}
