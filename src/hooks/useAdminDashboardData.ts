import { useEffect, useState } from 'react';
import type { AdminDashboardData } from '../lib/admin-api';
import { fetchAdminDashboardData } from '../lib/admin-api';

interface UseAdminDashboardData {
  data: AdminDashboardData | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

export function useAdminDashboardData(): UseAdminDashboardData {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const result = await fetchAdminDashboardData();
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

    load();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = () => setNonce((n) => n + 1);

  return { data, loading, error, reload };
}
