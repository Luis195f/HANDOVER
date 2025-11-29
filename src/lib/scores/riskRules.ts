import { getEffectiveRiskConfig } from '@/src/config/riskConfig';
import type { RiskConfig } from '@/src/types/risk';

import type { BradenResult } from './braden';
import type { News2Result } from './news2';

export type RiskLevel = 'low' | 'moderate' | 'high';

export interface RiskEvaluation {
  news2: News2Result | null;
  braden: BradenResult | null;
  level: RiskLevel;
  reasons: string[];
}

export function evaluateRisk(
  news2: News2Result | null,
  braden: BradenResult | null,
  config: RiskConfig = getEffectiveRiskConfig(),
): RiskEvaluation {
  const reasons: string[] = [];
  let level: RiskLevel = 'low';

  if (news2 && news2.total >= config.news2HighThreshold) {
    level = 'high';
    reasons.push(`NEWS2 elevado (${news2.total} puntos ≥ ${config.news2HighThreshold}).`);
  }

  if (braden && braden.total <= config.bradenHighThreshold) {
    level = 'high';
    reasons.push(`Braden bajo (${braden.total} puntos ≤ ${config.bradenHighThreshold}).`);
  }

  if (level !== 'high' && news2 && news2.total >= config.news2ModerateThreshold) {
    level = 'moderate';
    reasons.push(`NEWS2 moderado (${news2.total} puntos).`);
  }

  return { news2, braden, level, reasons };
}
