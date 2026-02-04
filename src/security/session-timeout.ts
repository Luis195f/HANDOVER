export type SessionTimeoutReason = 'idle' | 'background';

export type SessionTimeoutController = {
  recordActivity: (source?: string) => void;
  onAppStateChange: (state: string) => void;
  stop: () => void;
};

export type SessionTimeoutOptions = {
  idleMs: number;
  onTimeout: (reason: SessionTimeoutReason) => void;
  onActivity?: (source?: string) => void;
  now?: () => number;
};

export function createSessionTimeoutController(options: SessionTimeoutOptions): SessionTimeoutController {
  const { idleMs, onTimeout, onActivity, now = () => Date.now() } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backgroundAt: number | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (!Number.isFinite(idleMs) || idleMs <= 0) return;
    clearTimer();
    timer = setTimeout(() => {
      onTimeout('idle');
    }, idleMs);
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
      const elapsed = backgroundAt ? now() - backgroundAt : 0;
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
  };

  schedule();

  return {
    recordActivity,
    onAppStateChange,
    stop,
  };
}
