export type SessionTimeoutConfig = {
  idleMinutes: number;
  hardMinutes: number;
};

const DEFAULT_IDLE_MINUTES = 15;
const DEFAULT_HARD_MINUTES = 30;

function readPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getSessionTimeoutConfig(): SessionTimeoutConfig {
  const idleEnv = readPositiveInt(process.env.EXPO_PUBLIC_SESSION_IDLE_MINUTES);
  const hardEnv = readPositiveInt(process.env.EXPO_PUBLIC_SESSION_HARD_MINUTES);

  return {
    idleMinutes: idleEnv ?? DEFAULT_IDLE_MINUTES,
    hardMinutes: hardEnv ?? DEFAULT_HARD_MINUTES,
  };
}

export function getSessionTimeoutMs(): { idleMs: number; hardMs: number } {
  const { idleMinutes, hardMinutes } = getSessionTimeoutConfig();
  return {
    idleMs: idleMinutes * 60 * 1000,
    hardMs: hardMinutes * 60 * 1000,
  };
}
