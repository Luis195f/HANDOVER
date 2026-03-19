import {
  computeMPACFromInput,
  getIncidentSortTime,
  type MPACExplanation,
  type MPACInput,
  type MPACPriorityLevel,
  type MPACPriorityOverride,
  type MPACReasonCode,
  type MPACResult,
} from './mpac';

export type PriorityLevel = MPACPriorityLevel;
export type PriorityReasonCode = MPACReasonCode;
export type PriorityOverride = MPACPriorityOverride;

export interface PrioritizedPatient {
  patientId: string;
  displayName: string;
  bedLabel?: string;
  news2Score: number;
  level: PriorityLevel;
  reasons: PriorityReasonCode[];
  reasonSummary: string;
  totalScore?: number;
  baseScore?: number;
  baseLevel?: PriorityLevel;
  pendingCriticalTasksCount?: number;
  explanation?: MPACExplanation;
  manualOverride?: PriorityOverride;
}

type PrioritizedPatientInternal = MPACResult & { incidentMs: number | null };

export interface PriorityInput extends MPACInput {}

const levelWeights: Record<PriorityLevel, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export function computePriority(input: PriorityInput): PrioritizedPatient {
  const { incidentMs: _incidentMs, ...patient } = {
    ...computeMPACFromInput(input),
    incidentMs: getIncidentSortTime(input),
  } satisfies PrioritizedPatientInternal;

  return patient;
}

export function computePriorityList(inputs: PriorityInput[]): PrioritizedPatient[] {
  const prioritized = inputs.map((input) => {
    const patient = {
      ...computeMPACFromInput(input),
      incidentMs: getIncidentSortTime(input),
    } satisfies PrioritizedPatientInternal;

    return {
      patient,
      meta: {
        levelWeight: levelWeights[patient.level],
        totalScore: patient.totalScore,
        incidentMs: patient.incidentMs,
      },
    };
  });

  prioritized.sort((a, b) => {
    if (b.meta.levelWeight !== a.meta.levelWeight) return b.meta.levelWeight - a.meta.levelWeight;
    if (b.meta.totalScore !== a.meta.totalScore) return b.meta.totalScore - a.meta.totalScore;
    if (b.patient.news2Score !== a.patient.news2Score) return b.patient.news2Score - a.patient.news2Score;
    const incidentA = a.meta.incidentMs;
    const incidentB = b.meta.incidentMs;
    if (incidentA != null && incidentB != null && incidentA !== incidentB) return incidentB - incidentA;
    if (incidentA == null && incidentB != null) return 1;
    if (incidentA != null && incidentB == null) return -1;
    return a.patient.displayName.localeCompare(b.patient.displayName);
  });

  return prioritized.map(({ patient }) => {
    const { incidentMs: _incidentMs, ...rest } = patient;
    return rest;
  });
}

export default { computePriority, computePriorityList };
