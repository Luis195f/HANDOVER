import { useEffect, useState } from 'react';
import { fetchAdminDashboardData, refreshIceaDashboardSummary } from '../lib/admin-api';
import type { IceaDashboardSummary } from '../types/admin';

interface UseAdminDashboardData {
  data: IceaDashboardSummary | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  refreshRemoteSummary: (unitId: string) => Promise<void>;
  refreshingUnitId: string | null;
}

export function useAdminDashboardData(enabled = true, unitId?: string): UseAdminDashboardData {
  const [data, setData] = useState<IceaDashboardSummary | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [refreshingUnitId, setRefreshingUnitId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const result = await fetchAdminDashboardData(unitId);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, unitId]);

  const reload = () => setNonce((n) => n + 1);

  const refreshRemoteSummary = async (targetUnitId: string) => {
    setRefreshingUnitId(targetUnitId);
    try {
      await refreshIceaDashboardSummary(targetUnitId);
      setNonce((n) => n + 1);
    } finally {
      setRefreshingUnitId(null);
    }
  };

  return { data, loading, error, reload, refreshRemoteSummary, refreshingUnitId };
}
