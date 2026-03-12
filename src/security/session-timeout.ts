export type SessionTimeoutReason = 'idle' | 'background' | 'hard';

export type SessionTimeoutController = {
  recordActivity: (source?: string) => void;
  onAppStateChange: (state: string) => void;
  stop: () => void;
};

export type SessionTimeoutOptions = {
  idleMs: number;
  hardMs?: number;
  onTimeout: (reason: SessionTimeoutReason) => void;
  onActivity?: (source?: string) => void;
  now?: () => number;
};

export function createSessionTimeoutController(options: SessionTimeoutOptions): SessionTimeoutController {
  const { idleMs, hardMs, onTimeout, onActivity, now = () => Date.now() } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundAt: number | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clearHardTimer = () => {
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
  };

  const schedule = () => {
    if (!Number.isFinite(idleMs) || idleMs <= 0) return;
    clearTimer();
    timer = setTimeout(() => {
      onTimeout('idle');
    }, idleMs);
  };

  const scheduleHardTimeout = () => {
    if (!Number.isFinite(hardMs) || !hardMs || hardMs <= 0) return;
    clearHardTimer();
    hardTimer = setTimeout(() => {
      onTimeout('hard');
    }, hardMs);
  };

  const recordActivity = (source?: string) => {
    onActivity?.(source);
    schedule();
  };

  const onAppStateChange = (state: string) => {
    if (state === 'background' || state === 'inactive') {
      backgroundAt = now();
      clearTimer();
      return;
    }

    if (state === 'active') {
      const elapsed = backgroundAt !== null ? now() - backgroundAt : 0;
      backgroundAt = null;
      if (Number.isFinite(elapsed) && elapsed >= idleMs) {
        onTimeout('background');
        return;
      }
      schedule();
    }
  };

  const stop = () => {
    backgroundAt = null;
    clearTimer();
    clearHardTimer();
  };

  schedule();
  scheduleHardTimeout();

  return {
    recordActivity,
    onAppStateChange,
    stop,
  };
}
