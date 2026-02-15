const TRUTHY_VALUES = new Set(['1', 'true', 'yes']);

export function isDemoAccessEnabled(): boolean {
  if (__DEV__) return true;

  const raw = process.env.EXPO_PUBLIC_ENABLE_DEMO;
  if (typeof raw !== 'string') return false;

  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}
