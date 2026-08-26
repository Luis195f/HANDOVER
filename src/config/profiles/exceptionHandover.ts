export const CLINICAL_SOURCES = [
  'direct-assessment',
  'observation-record',
  'medication-administration',
  'care-plan',
  'incident-log',
] as const;

export type ClinicalSource = (typeof CLINICAL_SOURCES)[number];

export type ExceptionHandoverProfileConfig = {
  profileId: 'behavioral-health';
  expectedFreshnessMinutes: Readonly<Record<ClinicalSource, number>>;
  baseExpectedSources: readonly ClinicalSource[];
  criticalSources: readonly ClinicalSource[];
  ratioRWarning: number;
  absoluteRWarning: number;
  maxRAgeMinutes: number;
  recoveryStabilityMinutes: number;
  checkBackBypassWarningRatio: number;
  provisionalDemoThresholds: true;
  interactionBudgets: Readonly<Record<'A' | 'B' | 'C' | 'R' | 'degraded', number>>;
};

/**
 * Demo governance only. Thresholds are configurable and intentionally not
 * represented as clinically validated limits.
 */
export const BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG: ExceptionHandoverProfileConfig = {
  profileId: 'behavioral-health',
  expectedFreshnessMinutes: {
    'direct-assessment': 240,
    'observation-record': 120,
    'medication-administration': 480,
    'care-plan': 720,
    'incident-log': 480,
  },
  baseExpectedSources: ['direct-assessment', 'care-plan'],
  criticalSources: ['direct-assessment', 'care-plan'],
  ratioRWarning: 0.2,
  absoluteRWarning: 8,
  maxRAgeMinutes: 120,
  recoveryStabilityMinutes: 15,
  checkBackBypassWarningRatio: 0.1,
  provisionalDemoThresholds: true,
  interactionBudgets: {
    A: 8,
    B: 4,
    C: 2,
    R: 4,
    degraded: 3,
  },
};
