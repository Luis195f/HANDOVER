import { useEffect, useState } from 'react';

import { fetchIceaBridgeStatus } from '@/src/lib/icea-bridge-api';
import type { IceaBridgeScoringMode, IceaBridgeStatusResponse } from '@/src/types/icea';

export function useIceaBridgeStatus(handoverId?: string, options?: { scoringMode?: IceaBridgeScoringMode; refresh?: boolean }) {
  const [data, setData] = useState<IceaBridgeStatusResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(handoverId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!handoverId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIceaBridgeStatus(handoverId, options)
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
  }, [handoverId, options?.refresh, options?.scoringMode]);

  return { data, loading, error };
}
