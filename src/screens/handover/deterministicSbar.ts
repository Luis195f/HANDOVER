import { formatSbar, generateSbarSummary } from '@/src/lib/summary';
import type { HandoverValues } from '@/src/validation/schemas';
import type { SBARSummary } from '@/src/types/sbar';

export type DeterministicSbar = {
  summary: SBARSummary;
  fullText: string;
  fingerprint: string;
};

const normalize = (value?: string | null) => value?.trim() ?? '';

export function hasSbarContent(values: HandoverValues): boolean {
  return [
    values.sbarSituation,
    values.sbarBackground,
    values.sbarAssessment,
    values.sbarRecommendation,
    values.closingSummary,
    values.sbarFullText,
  ].some((value) => normalize(value).length > 0);
}

export function getSbarFingerprint(values: HandoverValues): string {
  return JSON.stringify([
    normalize(values.sbarSituation),
    normalize(values.sbarBackground),
    normalize(values.sbarAssessment),
    normalize(values.sbarRecommendation),
    normalize(values.closingSummary),
  ]);
}

export function createDeterministicSbar(
  values: HandoverValues,
  provenanceNotice: string,
): DeterministicSbar {
  const summary = generateSbarSummary(values, { locale: 'es', maxCharsPerSection: 320 });
  const formatted = formatSbar(summary, 'es');
  const fullText = provenanceNotice.trim()
    ? `${formatted}\n\n${provenanceNotice.trim()}`
    : formatted;
  const fingerprint = JSON.stringify([
    summary.situation.trim(),
    summary.background.trim(),
    summary.assessment.trim(),
    summary.recommendation.trim(),
    fullText.trim(),
  ]);

  return { summary, fullText, fingerprint };
}

export function createInitialDeterministicSbar(
  values: HandoverValues,
  provenanceNotice: string,
): DeterministicSbar | null {
  return hasSbarContent(values) ? null : createDeterministicSbar(values, provenanceNotice);
}
