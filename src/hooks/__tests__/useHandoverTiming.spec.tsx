import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useHandoverTiming } from '../useHandoverTiming';

const TestComponent = ({
  enabled,
  sender,
  now,
}: {
  enabled: boolean;
  sender: (input: { sectionId: string; durationMs: number; unitId?: string; requestId?: string }) => Promise<unknown>;
  now: () => number;
}) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = useHandoverTiming({ enabled, sender, now });
  (TestComponent as any).state = state;
  return null;
};

describe('useHandoverTiming', () => {
  it('acumula por sección y envía en flush', async () => {
    const sender = vi.fn(async () => undefined);
    let t = 0;
    const now = () => t;

    await act(async () => {
      create(<TestComponent enabled sender={sender} now={now} />);
    });

    const hook = (TestComponent as any).state as ReturnType<typeof useHandoverTiming>;

    act(() => {
      hook.start('sbar');
      t = 125;
      hook.stop('sbar');
      hook.start('sbar');
      t = 200;
      hook.stop('sbar');
      hook.start('vitals');
      t = 280;
      hook.stop('vitals');
    });

    await act(async () => {
      await hook.flush({ unitId: 'icu', requestId: 'tx-1' });
    });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'sbar', durationMs: 200, unitId: 'icu', requestId: 'tx-1' }),
    );
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: 'vitals', durationMs: 80, unitId: 'icu', requestId: 'tx-1' }),
    );
  });

  it('con flag desactivado no registra ni envía', async () => {
    const sender = vi.fn(async () => undefined);
    let t = 0;
    const now = () => t;

    await act(async () => {
      create(<TestComponent enabled={false} sender={sender} now={now} />);
    });

    const hook = (TestComponent as any).state as ReturnType<typeof useHandoverTiming>;

    act(() => {
      hook.start('diagnostics');
      t = 500;
      hook.stop('diagnostics');
    });

    await act(async () => {
      await hook.flush({ unitId: 'icu', requestId: 'tx-off' });
    });

    expect(sender).not.toHaveBeenCalled();
  });
});
