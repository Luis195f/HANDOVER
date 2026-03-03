import { describe, expect, it, vi } from 'vitest';

import { flushHandoverTimingBestEffort } from '@/src/lib/handover-timing-submit';

describe('flushHandoverTimingBestEffort', () => {
  it('does not throw when flush fails', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = vi.fn();

    await expect(
      flushHandoverTimingBestEffort({
        enabled: true,
        flush,
        unitId: 'icu-a',
        requestId: 'tx-1',
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(flush).toHaveBeenCalledWith({ unitId: 'icu-a', requestId: 'tx-1' });
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('skips flush when metrics are disabled', async () => {
    const flush = vi.fn();

    await flushHandoverTimingBestEffort({
      enabled: false,
      flush,
      unitId: 'icu-a',
      requestId: 'tx-1',
    });

    expect(flush).not.toHaveBeenCalled();
  });
});
