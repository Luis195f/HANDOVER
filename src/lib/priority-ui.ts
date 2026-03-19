import type { PendingTaskSummary } from '@/src/types/handover';

import type { HandoverAlert } from './alerts';
import type { PrioritizedPatient } from './priority';

export type PriorityUiTone = 'critical' | 'warning' | 'info' | 'neutral';

export interface PriorityToneStyles {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

export interface PriorityUiModel {
  hasSignal: boolean;
  whyNow: string;
  actionLabel?: string;
  omissionLabel?: string;
  omissionTone?: PriorityUiTone;
  windowLabel?: string;
  windowTone?: PriorityUiTone;
}

type OpenTaskAssessment = {
  task: PendingTaskSummary;
  isCritical: boolean;
  isUrgent: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  dueAtMs: number | null;
};

function getOncologyAppliedModifier(patient: PrioritizedPatient) {
  if (!patient.explanation?.activeContext.specialtyOverlayIds.includes('onc')) {
    return undefined;
  }

  return patient.explanation.modifiers.find(
    (modifier) => modifier.applied && modifier.source === 'specialty-overlay' && modifier.profileId === 'onc',
  );
}

const DUE_SOON_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export function getPriorityToneStyles(tone: PriorityUiTone): PriorityToneStyles {
  switch (tone) {
    case 'critical':
      return { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', textColor: '#991B1B' };
    case 'warning':
      return { backgroundColor: '#FFFBEB', borderColor: '#FCD34D', textColor: '#92400E' };
    case 'info':
      return { backgroundColor: '#EFF6FF', borderColor: '#93C5FD', textColor: '#1D4ED8' };
    case 'neutral':
    default:
      return { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', textColor: '#334155' };
  }
}

function parseTimeMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getReferenceTimeMs(referenceTime?: string | number | Date): number {
  const parsed = referenceTime == null ? Number.NaN : new Date(referenceTime).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function buildOpenTaskAssessments(
  tasks: readonly PendingTaskSummary[],
  referenceTimeMs: number,
): OpenTaskAssessment[] {
  return tasks
    .filter((task) => task.status !== 'done')
    .map((task) => {
      const dueAtMs = parseTimeMs(task.dueBy);
      const isCritical =
        Boolean(task.critical) || task.priority === 'critical' || task.category === 'escalation';
      const isUrgent = isCritical || Boolean(task.urgent) || task.priority === 'urgent';
      const isOverdue = dueAtMs != null && dueAtMs < referenceTimeMs;
      const isDueSoon =
        dueAtMs != null && dueAtMs >= referenceTimeMs && dueAtMs - referenceTimeMs <= DUE_SOON_THRESHOLD_MS;

      return {
        task,
        isCritical,
        isUrgent,
        isOverdue,
        isDueSoon,
        dueAtMs,
      };
    })
    .sort((left, right) => {
      const leftWeight =
        (left.isOverdue ? 8 : 0) +
        (left.isCritical ? 4 : 0) +
        (left.isUrgent ? 2 : 0) +
        (left.isDueSoon ? 1 : 0);
      const rightWeight =
        (right.isOverdue ? 8 : 0) +
        (right.isCritical ? 4 : 0) +
        (right.isUrgent ? 2 : 0) +
        (right.isDueSoon ? 1 : 0);

      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }

      if (left.dueAtMs != null && right.dueAtMs != null && left.dueAtMs !== right.dueAtMs) {
        return left.dueAtMs - right.dueAtMs;
      }

      if (left.dueAtMs == null && right.dueAtMs != null) return 1;
      if (left.dueAtMs != null && right.dueAtMs == null) return -1;

      return left.task.title.localeCompare(right.task.title);
    });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const totalHours = Math.round(totalMinutes / 60);
  return `${totalHours} h`;
}

function getWindowCopy(
  task: OpenTaskAssessment | undefined,
  referenceTimeMs: number,
): Pick<PriorityUiModel, 'windowLabel' | 'windowTone'> {
  if (!task) {
    return {};
  }

  if (task.dueAtMs == null) {
    return {
      windowLabel: task.isCritical || task.isUrgent ? 'Ventana: este turno' : undefined,
      windowTone: task.isCritical ? 'warning' : 'neutral',
    };
  }

  const deltaMs = task.dueAtMs - referenceTimeMs;
  if (deltaMs < 0) {
    return {
      windowLabel: `Ventana vencida hace ${formatDuration(Math.abs(deltaMs))}`,
      windowTone: 'critical',
    };
  }
  if (deltaMs <= DUE_SOON_THRESHOLD_MS) {
    return {
      windowLabel: `Ventana en ${formatDuration(deltaMs)}`,
      windowTone: task.isCritical ? 'critical' : 'warning',
    };
  }

  return {
    windowLabel: 'Ventana: este turno',
    windowTone: task.isCritical || task.isUrgent ? 'warning' : 'neutral',
  };
}

function buildWhyNow(patient: PrioritizedPatient): string {
  const clinicalChange = patient.explanation?.clinicalChange[0];
  if (clinicalChange) {
    return clinicalChange;
  }

  const appliedModifier = getOncologyAppliedModifier(patient);
  if (appliedModifier) {
    return `Contexto activo: ${appliedModifier.label}`;
  }

  const sourceData = patient.explanation?.sourceData[0];
  if (sourceData) {
    return sourceData;
  }

  if (patient.reasonSummary.trim().length > 0) {
    return patient.reasonSummary;
  }

  return 'Sin señal contextual relevante en este momento.';
}

function buildActionLabel(
  task: OpenTaskAssessment | undefined,
  patient: PrioritizedPatient,
  alerts: readonly HandoverAlert[],
): string | undefined {
  if (task) {
    return `No omitir: ${task.task.title}`;
  }

  const pendingCritical = patient.explanation?.pendingCritical[0];
  if (pendingCritical) {
    return `No omitir: ${pendingCritical}`;
  }

  if (alerts.some((alert) => alert.severity === 'critical')) {
    return 'No omitir: revisar alertas críticas activas';
  }

  const appliedModifier = getOncologyAppliedModifier(patient);
  if (appliedModifier) {
    return `No omitir: ${appliedModifier.label}`;
  }

  return undefined;
}

function buildOmissionCopy(
  task: OpenTaskAssessment | undefined,
  patient: PrioritizedPatient,
  alerts: readonly HandoverAlert[],
): Pick<PriorityUiModel, 'omissionLabel' | 'omissionTone'> {
  if (task?.isCritical || task?.isOverdue || alerts.some((alert) => alert.severity === 'critical')) {
    return { omissionLabel: 'Riesgo de omisión alto', omissionTone: 'critical' };
  }

  if (
    task?.isUrgent ||
    (patient.pendingCriticalTasksCount ?? 0) > 0 ||
    alerts.some((alert) => alert.severity === 'warning') ||
    patient.reasons.includes('HIGH_RISK_FLAGS')
  ) {
    return { omissionLabel: 'Riesgo de omisión moderado', omissionTone: 'warning' };
  }

  if (patient.level !== 'low' || patient.news2Score >= 3) {
    return { omissionLabel: 'Mantener vigilancia', omissionTone: 'info' };
  }

  return {};
}

export function hasActionablePrioritySignal(patient: PrioritizedPatient): boolean {
  return (
    patient.level !== 'low' ||
    patient.news2Score >= 3 ||
    patient.reasons.length > 0 ||
    (patient.pendingCriticalTasksCount ?? 0) > 0 ||
    (patient.explanation?.clinicalChange.length ?? 0) > 0 ||
    (patient.explanation?.modifiers.some((modifier) => modifier.applied) ?? false)
  );
}

export function buildPriorityUiModel(params: {
  patient: PrioritizedPatient;
  pendingTasks?: readonly PendingTaskSummary[];
  alerts?: readonly HandoverAlert[];
  referenceTime?: string | number | Date;
}): PriorityUiModel {
  const { patient } = params;
  const alerts = params.alerts ?? [];
  const referenceTimeMs = getReferenceTimeMs(params.referenceTime);
  const openTasks = buildOpenTaskAssessments(params.pendingTasks ?? [], referenceTimeMs);
  const primaryTask = openTasks[0];
  const hasSignal = hasActionablePrioritySignal(patient);
  const omission = buildOmissionCopy(primaryTask, patient, alerts);
  const window = getWindowCopy(primaryTask, referenceTimeMs);
  const hasContextualReevaluationWindow =
    patient.explanation?.activeContext.specialtyOverlayIds.includes('onc') &&
    (patient.explanation?.modifiers.some(
      (modifier) =>
        modifier.applied &&
        modifier.profileId === 'onc' &&
        (modifier.dimension === 'time-critical' || modifier.dimension === 'deterioration-risk'),
    ) ?? false);

  return {
    hasSignal,
    whyNow: buildWhyNow(patient),
    actionLabel: buildActionLabel(primaryTask, patient, alerts),
    omissionLabel: omission.omissionLabel,
    omissionTone: omission.omissionTone,
    windowLabel:
      window.windowLabel ??
      (patient.reasons.includes('RECENT_INCIDENT') || hasContextualReevaluationWindow
        ? 'Ventana: reevaluar este turno'
        : undefined),
    windowTone:
      window.windowTone ??
      (patient.reasons.includes('RECENT_INCIDENT') || hasContextualReevaluationWindow ? 'warning' : undefined),
  };
}
