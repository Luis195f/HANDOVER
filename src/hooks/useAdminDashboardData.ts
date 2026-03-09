import { useEffect, useState } from 'react';
import { AdminDashboardApiError, fetchAdminDashboardData, refreshIceaDashboardSummary } from '../lib/admin-api';
import type { IceaDashboardSummary } from '../types/admin';

interface UseAdminDashboardDataOptions {
  unitId?: string;
  demoMode?: boolean;
}

interface UseAdminDashboardData {
  data: IceaDashboardSummary | null;
  loading: boolean;
  error: AdminDashboardApiError | null;
  reload: () => void;
  refreshRemoteSummary: (unitId: string) => Promise<void>;
  refreshingUnitId: string | null;
  stale: boolean;
  lastLoadedAt: string | null;
}

export function useAdminDashboardData(enabled = true, options?: UseAdminDashboardDataOptions): UseAdminDashboardData {
  const [data, setData] = useState<IceaDashboardSummary | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<AdminDashboardApiError | null>(null);
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
        const result = await fetchAdminDashboardData(options?.unitId, { demoMode: options?.demoMode });
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as AdminDashboardApiError);
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
  }, [enabled, nonce, options?.demoMode, options?.unitId]);

  const reload = () => setNonce((n) => n + 1);

  const refreshRemoteSummary = async (targetUnitId: string) => {
    setRefreshingUnitId(targetUnitId);
    try {
      await refreshIceaDashboardSummary(targetUnitId, { demoMode: options?.demoMode });
      setNonce((n) => n + 1);
    } finally {
      setRefreshingUnitId(null);
    }
  };

  return {
    data,
    loading,
    error,
    reload,
    refreshRemoteSummary,
    refreshingUnitId,
    stale: Boolean(data?.stale || (error && data)),
    lastLoadedAt: data?.generatedAt ?? null,
  };
}
