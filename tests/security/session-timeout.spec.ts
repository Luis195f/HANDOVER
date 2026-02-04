import { describe, expect, it, vi } from 'vitest';
import { createSessionTimeoutController } from '@/src/security/session-timeout';

describe('createSessionTimeoutController', () => {
  it('fires idle timeout after inactivity', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    createSessionTimeoutController({
      idleMs: 1000,
      onTimeout,
    });

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledWith('idle');

    vi.useRealTimers();
  });

  it('resets timer on activity', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const controller = createSessionTimeoutController({
      idleMs: 1000,
      onTimeout,
    });

    vi.advanceTimersByTime(600);
    controller.recordActivity('touch');
    vi.advanceTimersByTime(900);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onTimeout).toHaveBeenCalledWith('idle');

    controller.stop();
    vi.useRealTimers();
  });

  it('locks on background longer than idle window', () => {
    vi.useFakeTimers();
    let now = 1000;
    const onTimeout = vi.fn();

    const controller = createSessionTimeoutController({
      idleMs: 500,
      onTimeout,
      now: () => now,
    });

    controller.onAppStateChange('background');
    now += 600;
    controller.onAppStateChange('active');

    expect(onTimeout).toHaveBeenCalledWith('background');

    controller.stop();
    vi.useRealTimers();
  });
});
