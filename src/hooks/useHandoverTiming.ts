import { useCallback, useMemo, useRef } from 'react';

import type { HandoverTimingMetricInput, HandoverTimingSectionId } from '@/src/lib/handover-timing-metrics';

type Sender = (input: HandoverTimingMetricInput) => Promise<unknown>;

interface FlushContext {
  unitId?: string;
  requestId?: string;
}

interface UseHandoverTimingOptions {
  enabled: boolean;
  sender?: Sender;
  now?: () => number;
}

export function useHandoverTiming(options: UseHandoverTimingOptions) {
  const now = options.now ?? (() => performance.now());
  const senderRef = useRef<Sender | null>(options.sender ?? null);
  const activeRef = useRef<Partial<Record<HandoverTimingSectionId, number>>>({});
  const totalsRef = useRef<Record<HandoverTimingSectionId, number>>({
    sbar: 0,
    vitals: 0,
    diagnostics: 0,
    treatments: 0,
  });

  const resolveSender = useCallback(async (): Promise<Sender> => {
    if (senderRef.current) return senderRef.current;
    const metricsModule = await import('@/src/lib/handover-timing-metrics');
    senderRef.current = metricsModule.postHandoverTimingMetric;
    return senderRef.current;
  }, []);

  const start = useCallback(
    (sectionId: HandoverTimingSectionId) => {
      if (!options.enabled) return;
      if (typeof activeRef.current[sectionId] === 'number') return;
      activeRef.current[sectionId] = now();
    },
    [now, options.enabled],
  );

  const stop = useCallback(
    (sectionId: HandoverTimingSectionId) => {
      if (!options.enabled) return;
      const startedAt = activeRef.current[sectionId];
      if (typeof startedAt !== 'number') return;
      const duration = Math.max(0, now() - startedAt);
      totalsRef.current[sectionId] += duration;
      delete activeRef.current[sectionId];
    },
    [now, options.enabled],
  );

  const syncSectionState = useCallback(
    (sectionId: HandoverTimingSectionId, expanded: boolean) => {
      if (expanded) {
        start(sectionId);
      } else {
        stop(sectionId);
      }
    },
    [start, stop],
  );

  const flush = useCallback(
    async (ctx: FlushContext = {}) => {
      if (!options.enabled) return;

      const at = now();
      (Object.keys(activeRef.current) as HandoverTimingSectionId[]).forEach((sectionId) => {
        const startedAt = activeRef.current[sectionId];
        if (typeof startedAt !== 'number') return;
        totalsRef.current[sectionId] += Math.max(0, at - startedAt);
        delete activeRef.current[sectionId];
      });

      const payloads = (Object.entries(totalsRef.current) as Array<[HandoverTimingSectionId, number]>)
        .map(([sectionId, durationMs]) => ({
          sectionId,
          durationMs: Math.round(durationMs),
          unitId: ctx.unitId,
          requestId: ctx.requestId,
        }))
        .filter((item) => item.durationMs > 0);

      if (payloads.length === 0) return;

      const sender = await resolveSender();
      await Promise.all(payloads.map((item) => sender(item)));
      totalsRef.current = { sbar: 0, vitals: 0, diagnostics: 0, treatments: 0 };
    },
    [now, options.enabled, resolveSender],
  );

  const debugSnapshot = useCallback(() => ({ ...totalsRef.current }), []);

  return useMemo(
    () => ({ start, stop, syncSectionState, flush, debugSnapshot }),
    [debugSnapshot, flush, start, stop, syncSectionState],
  );
}
