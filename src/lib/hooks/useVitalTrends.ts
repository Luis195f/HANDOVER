// BEGIN HANDOVER D2 – VitalTrends hook
import { useEffect, useState } from 'react';

import { fetchVitalTrends } from '../fhir-client';
import type { VitalTrendsData } from '../../../types/vitals';

interface UseVitalTrendsResult {
  loading: boolean;
  error: string | null;
  data: VitalTrendsData | null;
}

export function useVitalTrends(
  patientId: string | undefined,
): UseVitalTrendsResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VitalTrendsData | null>(null);

  useEffect(() => {
    if (!patientId) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchVitalTrends(patientId, { hoursBack: 24, maxPointsPerSeries: 24 })
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message ?? 'Error cargando tendencias de signos vitales');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return { loading, error, data };
}
// END HANDOVER D2 – VitalTrends hook
