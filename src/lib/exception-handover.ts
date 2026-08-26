import type { DemoActorIdentity, DemoExceptionHandoverPatient } from '@/src/demo/fixtures';

export type ExceptionHandoverGroups = {
  critical: DemoExceptionHandoverPatient[];
  changed: DemoExceptionHandoverPatient[];
  unchanged: DemoExceptionHandoverPatient[];
};

export type ExceptionReviewEventKind =
  | 'unchanged_group_review'
  | 'brief_review'
  | 'critical_check_back'
  | 'critical_clarification'
  | 'outgoing_transfer'
  | 'incoming_attestation';

export type ExceptionReviewEvent = {
  kind: ExceptionReviewEventKind;
  actorId: string;
  actorName: string;
  actorKind: DemoActorIdentity['kind'];
  recordedAt: string;
  patientId?: string;
};

export type ExceptionSbar = {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
};

export function groupExceptionHandoverPatients(
  patients: readonly DemoExceptionHandoverPatient[],
): ExceptionHandoverGroups {
  return patients.reduce<ExceptionHandoverGroups>(
    (groups, patient) => {
      groups[patient.status].push(patient);
      return groups;
    },
    { critical: [], changed: [], unchanged: [] },
  );
}

export function formatExceptionDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date(value));
}

export function buildExceptionSbar(patient: DemoExceptionHandoverPatient): ExceptionSbar {
  return {
    situation: `${patient.name}, cama ${patient.bedLabel}. ${patient.change}`,
    background: `Resumen previo de ${patient.unitName}, actualizado el ${formatExceptionDateTime(patient.lastSummaryAt)}.`,
    assessment: patient.currentRisk,
    recommendation: `${patient.nextAction} Responsable: ${patient.owner}. Objetivo: ${formatExceptionDateTime(patient.dueAt)}. Si ${patient.contingency.trigger}, ${patient.contingency.response}.`,
  };
}

export function createExceptionReviewEvent(
  kind: ExceptionReviewEventKind,
  actor: DemoActorIdentity,
  recordedAt: string,
  patientId?: string,
): ExceptionReviewEvent {
  return {
    kind,
    actorId: actor.userId,
    actorName: actor.displayName,
    actorKind: actor.kind,
    recordedAt,
    ...(patientId ? { patientId } : {}),
  };
}
