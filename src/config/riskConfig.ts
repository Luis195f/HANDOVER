import { isOn } from './flags';

import type { RiskConfig } from '@/src/types/risk';

const DEFAULT_RISK_CONFIG: RiskConfig = {
  news2HighThreshold: 7,
  news2ModerateThreshold: 5,
  bradenHighThreshold: 12,
};

function parseEnvNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getRiskConfigOverrideFromEnv(): Partial<RiskConfig> {
  const overrides: Partial<RiskConfig> = {};

  const news2High =
    parseEnvNumber(process.env.EXPO_PUBLIC_NEWS2_HIGH_THRESHOLD) ??
    parseEnvNumber(process.env.NEWS2_HIGH_THRESHOLD);
  const news2Moderate =
    parseEnvNumber(process.env.EXPO_PUBLIC_NEWS2_MODERATE_THRESHOLD) ??
    parseEnvNumber(process.env.NEWS2_MODERATE_THRESHOLD);
  const bradenHigh =
    parseEnvNumber(process.env.EXPO_PUBLIC_BRADEN_HIGH_THRESHOLD) ??
    parseEnvNumber(process.env.BRADEN_HIGH_THRESHOLD);

  if (news2High != null) overrides.news2HighThreshold = news2High;
  if (news2Moderate != null) overrides.news2ModerateThreshold = news2Moderate;
  if (bradenHigh != null) overrides.bradenHighThreshold = bradenHigh;

  return overrides;
}

export function getEffectiveRiskConfig(): RiskConfig {
  const overrides = getRiskConfigOverrideFromEnv();

  // Futuro: permitir cargar configuración remota si existe un feature flag
  if (isOn('REMOTE_CONFIG_DISABLED_FOR_NOW')) {
    // Placeholder para backend remoto
  }

  return { ...DEFAULT_RISK_CONFIG, ...overrides };
}

export { DEFAULT_RISK_CONFIG };
