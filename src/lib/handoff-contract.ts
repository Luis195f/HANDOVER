import type {
  ExceptionActorIdentity,
  HandoffClassification,
  HandoffLane,
} from './exception-handover';

export type HandoffCommunication = {
  kind: 'HandoffCommunication';
  patientId: string;
  lane: Extract<HandoffLane, 'A' | 'B'>;
  preliminary: true;
  checkBackRequired: boolean;
};

export type HandoffProvenance = {
  kind: 'HandoffProvenance';
  actorId: string;
  actorName: string;
  recordedAt: string;
};

export type HandoffAudit = {
  kind: 'HandoffAudit';
  eventType: string;
  idempotencyKey: string;
};

export type HandoffTask = {
  kind: 'HandoffTask';
  patientId: string;
  description: string;
  owner: string;
  status: 'pending' | 'completed' | 'transferred';
};

export type HandoffSummary = {
  kind: 'HandoffSummary';
  patientId: string;
  validatedBy: ExceptionActorIdentity;
  validatedAt: string;
};

export const HANDOFF_FHIR_CAPABILITY_MATRIX = [
  { internal: 'HandoffCommunication', fhir: 'Communication', status: 'pending' },
  { internal: 'HandoffProvenance', fhir: 'Provenance', status: 'pending' },
  { internal: 'HandoffAudit', fhir: 'AuditEvent', status: 'pending' },
  { internal: 'HandoffTask', fhir: 'Task', status: 'pending' },
  { internal: 'HandoffSummary', fhir: 'Composition', status: 'supported-core-form-only' },
  { internal: 'PerformedAssessment', fhir: 'Observation', status: 'supported-core-form-only' },
] as const;

export type ExceptionHandoffContract = {
  communication: HandoffCommunication | null;
  tasks: HandoffTask[];
  individualSummary: HandoffSummary | null;
  productiveFhirResources: readonly [];
};

export function buildExceptionHandoffContract(
  classification: HandoffClassification,
): ExceptionHandoffContract {
  const communication = classification.handoffLane === 'A' || classification.handoffLane === 'B'
    ? {
        kind: 'HandoffCommunication' as const,
        patientId: classification.patientId,
        lane: classification.handoffLane,
        preliminary: true as const,
        checkBackRequired: classification.handoffLane === 'A',
      }
    : null;
  const tasks = classification.handoffLane === 'R'
    ? classification.reviewRequirements.map((requirement) => ({
        kind: 'HandoffTask' as const,
        patientId: classification.patientId,
        description: requirement.reason,
        owner: requirement.owner,
        status: 'pending' as const,
      }))
    : [];

  return {
    communication,
    tasks,
    individualSummary: null,
    productiveFhirResources: [],
  };
}
