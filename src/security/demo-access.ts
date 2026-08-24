import type { HandoverSession } from './auth-types';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes']);

function hasExplicitDemoFlag(): boolean {
  const raw = process.env.EXPO_PUBLIC_ENABLE_DEMO;
  if (typeof raw !== 'string') return false;

  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

export function isDemoAccessEnabled(): boolean {
  if (__DEV__) return true;

  return hasExplicitDemoFlag();
}

export function isDemoActorSwitchEnabled(session: HandoverSession | null | undefined): boolean {
  return session?.mode === 'demo' && hasExplicitDemoFlag();
}
