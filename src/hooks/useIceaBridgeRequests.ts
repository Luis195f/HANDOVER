import { useEffect, useState } from 'react';

import { fetchIceaBridgeRequests } from '@/src/lib/icea-bridge-api';
import type { IceaBridgeListResponse, IceaBridgeScoringMode } from '@/src/types/icea';

export function useIceaBridgeRequests(
  enabled = true,
  filters?: { patientId?: string; unitId?: string; shift?: string; status?: string; scoringMode?: IceaBridgeScoringMode; limit?: number },
) {
  const [data, setData] = useState<IceaBridgeListResponse>({ results: [], count: 0 });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData({ results: [], count: 0 });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIceaBridgeRequests(filters)
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
  }, [enabled, filters?.patientId, filters?.unitId, filters?.shift, filters?.status, filters?.scoringMode, filters?.limit]);

  return { data, loading, error };
}
