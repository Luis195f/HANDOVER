type FlushContext = { unitId?: string; requestId?: string };
type FlushFn = (context?: FlushContext) => Promise<void>;

type FlushArgs = {
  enabled: boolean;
  flush: FlushFn;
  unitId?: string | null;
  requestId: string;
  logger?: (message?: unknown, ...optionalParams: unknown[]) => void;
};

export async function flushHandoverTimingBestEffort({
  enabled,
  flush,
  unitId,
  requestId,
  logger = console.warn,
}: FlushArgs): Promise<void> {
  if (!enabled) return;

  try {
    await flush({ unitId: unitId ?? undefined, requestId });
  } catch (timingError) {
    const timingErrorMessage = timingError instanceof Error ? timingError.message : String(timingError);
    logger('[handover-timing] flush_failed', {
      requestId,
      unitId: unitId ?? '',
      error: timingErrorMessage.slice(0, 160),
    });
  }
}
