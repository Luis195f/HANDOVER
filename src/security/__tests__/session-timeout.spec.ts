import { describe, expect, it, vi } from 'vitest';

import { createSessionTimeoutController } from '@/src/security/session-timeout';

describe('createSessionTimeoutController', () => {
  it('fires idle timeout after inactivity', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    createSessionTimeoutController({ idleMs: 1000, hardMs: 5000, onTimeout });

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledWith('idle');
    vi.useRealTimers();
  });

  it('fires background timeout when returning after idle threshold', () => {
    const onTimeout = vi.fn();
    let nowValue = 0;
    const controller = createSessionTimeoutController({
      idleMs: 500,
      hardMs: 5000,
      onTimeout,
      now: () => nowValue,
    });

    controller.onAppStateChange('background');
    nowValue = 700;
    controller.onAppStateChange('active');

    expect(onTimeout).toHaveBeenCalledWith('background');
  });

  it('fires hard timeout after max session duration', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    createSessionTimeoutController({ idleMs: 10000, hardMs: 2000, onTimeout });

    vi.advanceTimersByTime(2000);
    expect(onTimeout).toHaveBeenCalledWith('hard');
    vi.useRealTimers();
  });
});
