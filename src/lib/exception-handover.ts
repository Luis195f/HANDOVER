import {
  BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG,
  CLINICAL_SOURCES,
  type ClinicalSource,
  type ExceptionHandoverProfileConfig,
} from '@/src/config/profiles/exceptionHandover';

export type ClinicalStatus = 'stable' | 'watcher' | 'unstable';
export type HandoffLane = 'A' | 'B' | 'C' | 'R';
export type SourceStatus = 'current' | 'stale' | 'missing' | 'unavailable';
export type UnitDataHealth = 'healthy' | 'degraded' | 'unavailable';
export type TransferStatus = 'completed' | 'pending-acknowledgement' | 'escalated';
export type ObservationLevel = 'routine' | 'enhanced' | 'constant';
export type RReviewState = 'open' | 'resolved' | 'transferred';

export type ExceptionActorIdentity = {
  userId: string;
  displayName: string;
  kind: 'outgoing' | 'incoming';
};

export type SourceEvidence = {
  status: SourceStatus;
  observedAt?: string;
  coherent?: boolean;
  verifiable?: boolean;
};

export type ExceptionPatientPlan = {
  requiresMedicationVerification?: boolean;
  requiresDirectAssessment?: boolean;
  requiresLeaveReview?: boolean;
  restrictiveInterventionReviewDue?: boolean;
};

export type ExceptionPatientClassificationInput = {
  patientId: string;
  status: 'critical' | 'changed' | 'unchanged';
  change: string;
  lastSummaryAt: string;
  profileId?: 'behavioral-health';
  shiftId?: string;
  observationLevel?: ObservationLevel;
  activeRisks?: readonly string[];
  plan?: ExceptionPatientPlan;
  sourceEvidence?: Partial<Record<ClinicalSource, SourceEvidence>>;
  reviewOwner?: string;
  previousOverrides?: readonly HandoffOverride[];
};

export type RReviewRequirement = {
  source: ClinicalSource;
  sourceStatus: SourceStatus;
  reason: string;
  ageMinutes: number | null;
  owner: string;
  state: RReviewState;
  enteredAt: string;
};

export type HandoffOverride = {
  idempotencyKey: string;
  patientId: string;
  previousLane: HandoffLane;
  newLane: HandoffLane;
  reason: string;
  professionalId: string;
  professionalName: string;
  shiftId: string;
  recordedAt: string;
  sourceStatuses: Partial<Record<ClinicalSource, SourceStatus>>;
};

export type HandoffClassification = {
  patientId: string;
  clinicalStatus: ClinicalStatus;
  handoffLane: HandoffLane;
  baselineLane: Exclude<HandoffLane, 'R'>;
  reasons: string[];
  classifiedAt: string;
  classifiedBy: 'rule' | 'human';
  sourceStatuses: Partial<Record<ClinicalSource, SourceStatus>>;
  oldestRelevantSourceTimestamp: string | null;
  overrideReason?: string;
  previousOverride?: HandoffOverride;
  reviewRequirements: RReviewRequirement[];
};

export type UnitIntegrationState = {
  availability: 'available' | 'partial' | 'unavailable';
  sourceStatuses?: Partial<Record<ClinicalSource, SourceStatus>>;
  failureStartedAt?: string;
  recoveryConfirmedAt?: string;
  stableSince?: string;
};

export type UnitHealthAssessment = {
  status: UnitDataHealth;
  affectedSources: ClinicalSource[];
  reason: string | null;
  requiresExplicitRecovery: boolean;
};

export type UnitClassificationResult = {
  unitDataHealth: UnitHealthAssessment;
  classifications: HandoffClassification[];
  lastKnownClassifications: HandoffClassification[];
  lastKnownClassifiedAt: string | null;
  automaticClassificationSuspended: boolean;
};

export type ExceptionHandoverGroups<T> = {
  critical: T[];
  changed: T[];
  unchanged: T[];
  review: T[];
};

export type ExceptionReviewEventKind =
  | 'unchanged_group_review'
  | 'brief_review'
  | 'critical_check_back'
  | 'critical_clarification'
  | 'critical_escalated'
  | 'r_cause_acknowledgement'
  | 'r_resolved'
  | 'r_transferred'
  | 'outgoing_transfer'
  | 'incoming_attestation'
  | 'unit_incident_acknowledgement'
  | 'degraded_outgoing_transfer'
  | 'degraded_incoming_acknowledgement'
  | 'override_recorded';

export type ExceptionReviewEvent = {
  idempotencyKey: string;
  kind: ExceptionReviewEventKind;
  actorId: string;
  actorName: string;
  actorKind: ExceptionActorIdentity['kind'];
  recordedAt: string;
  shiftId: string;
  patientId?: string;
  source?: ClinicalSource;
  reason?: string;
  targetAt?: string;
  receiverId?: string;
  criticalPoints?: string[];
};

export type ExceptionSbar = {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
};

export type RMetrics = {
  countR: number;
  ratioR: number;
  oldestRAge: number;
  affectedSources: ClinicalSource[];
  meanTimeInR: number;
  resolvedR: number;
  transferredUnresolvedR: number;
};

export type CheckBackMetrics = {
  requiredCheckBacks: number;
  completedCheckBacks: number;
  pendingCheckBacks: number;
  bypassCount: number;
  bypassRate: number;
  clarificationCount: number;
};

export type DegradedUnitTransfer = {
  priorityPatientIds: string[];
  changedPatientIds: string[];
  criticalPendings: string[];
  receiverId: string;
  recordedAt: string;
};

export type HandoffClosureAssessment = {
  canClose: boolean;
  blockingReasons: string[];
};

export const COLLECTIVE_REVIEW_RESPONSIBILITY_COPY =
  'Revisión colectiva del resumen de unidad. No constituye validación individual de valores clínicos ni genera evoluciones individuales. La responsabilidad asistencial del turno se transfiere al equipo receptor.';

export const DEGRADED_HANDOFF_RESPONSIBILITY_COPY =
  'Clasificación automática suspendida. El relevo se realiza con información parcial y con las excepciones registradas manualmente.';

const SOURCE_LABELS: Readonly<Record<ClinicalSource, string>> = {
  'direct-assessment': 'valoración directa',
  'observation-record': 'registro de observación',
  'medication-administration': 'administración de medicación',
  'care-plan': 'plan vigente',
  'incident-log': 'registro de incidencias y retornos',
};

const DEFAULT_SHIFT_ID = 'demo-2026-08-27-morning';
const MINUTE_MS = 60_000;

const parseTimestamp = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const minutesBetween = (start: string | undefined, end: string): number | null => {
  const startMs = parseTimestamp(start);
  const endMs = parseTimestamp(end);
  if (startMs == null || endMs == null) return null;
  return Math.max(0, Math.floor((endMs - startMs) / MINUTE_MS));
};

const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const baselineLane = (status: ExceptionPatientClassificationInput['status']): Exclude<HandoffLane, 'R'> =>
  status === 'critical' ? 'A' : status === 'changed' ? 'B' : 'C';

const clinicalStatus = (lane: Exclude<HandoffLane, 'R'>): ClinicalStatus =>
  lane === 'A' ? 'unstable' : lane === 'B' ? 'watcher' : 'stable';

export function expectedSourcesForPatient(
  patient: ExceptionPatientClassificationInput,
  config: ExceptionHandoverProfileConfig = BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG,
): ClinicalSource[] {
  const expected = new Set<ClinicalSource>(config.baseExpectedSources);

  if (patient.plan?.requiresDirectAssessment) expected.add('direct-assessment');
  if ((patient.observationLevel ?? 'routine') !== 'routine' || (patient.activeRisks?.length ?? 0) > 0) {
    expected.add('observation-record');
  }
  if (patient.plan?.requiresMedicationVerification) expected.add('medication-administration');
  if (patient.plan?.requiresLeaveReview) expected.add('incident-log');

  return CLINICAL_SOURCES.filter((source) => expected.has(source));
}

type EvaluatedSource = {
  source: ClinicalSource;
  status: SourceStatus;
  observedAt: string | null;
  reason: string | null;
  ageMinutes: number | null;
};

function evaluateSource(
  source: ClinicalSource,
  evidence: SourceEvidence | undefined,
  now: string,
  config: ExceptionHandoverProfileConfig,
): EvaluatedSource {
  const label = SOURCE_LABELS[source];
  const observedAtMs = parseTimestamp(evidence?.observedAt);
  const ageMinutes = minutesBetween(evidence?.observedAt, now);

  if (!evidence || evidence.status === 'missing') {
    return { source, status: 'missing', observedAt: null, reason: `${label[0]?.toUpperCase()}${label.slice(1)} esperada ausente`, ageMinutes: null };
  }
  if (evidence.status === 'unavailable' || evidence.verifiable === false) {
    return { source, status: 'unavailable', observedAt: evidence.observedAt ?? null, reason: `${label[0]?.toUpperCase()}${label.slice(1)} no verificable`, ageMinutes };
  }
  if (evidence.coherent === false) {
    return { source, status: 'missing', observedAt: evidence.observedAt ?? null, reason: `${label[0]?.toUpperCase()}${label.slice(1)} incoherente`, ageMinutes };
  }
  if (observedAtMs == null) {
    return { source, status: 'missing', observedAt: null, reason: `Fecha y hora de ${label} no válidas`, ageMinutes: null };
  }
  if (evidence.status === 'stale' || (ageMinutes ?? 0) > config.expectedFreshnessMinutes[source]) {
    return { source, status: 'stale', observedAt: evidence.observedAt ?? null, reason: `${label[0]?.toUpperCase()}${label.slice(1)} requerida vencida`, ageMinutes };
  }
  return { source, status: 'current', observedAt: evidence.observedAt ?? null, reason: null, ageMinutes };
}

function findOverrides(patient: ExceptionPatientClassificationInput, shiftId: string) {
  const overrides = patient.previousOverrides ?? [];
  const active = [...overrides].reverse().find((override) => override.shiftId === shiftId);
  const previous = [...overrides].reverse().find((override) => override.shiftId !== shiftId);
  return { active, previous };
}

export function classifyExceptionHandoverPatient(
  patient: ExceptionPatientClassificationInput,
  options: {
    now: string;
    shiftId?: string;
    unitSourceStatuses?: Partial<Record<ClinicalSource, SourceStatus>>;
    failureStartedAt?: string;
    config?: ExceptionHandoverProfileConfig;
  },
): HandoffClassification {
  const config = options.config ?? BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG;
  const shiftId = options.shiftId ?? patient.shiftId ?? DEFAULT_SHIFT_ID;
  const baseLane = baselineLane(patient.status);
  const expectedSources = expectedSourcesForPatient(patient, config);
  const evaluated = expectedSources.map((source) => {
    const unitStatus = options.unitSourceStatuses?.[source];
    const evidence = unitStatus && unitStatus !== 'current'
      ? {
          status: unitStatus,
          observedAt: patient.sourceEvidence?.[source]?.observedAt ?? options.failureStartedAt,
        }
      : patient.sourceEvidence?.[source];
    return evaluateSource(source, evidence, options.now, config);
  });
  const sourceStatuses = Object.fromEntries(
    evaluated.map(({ source, status }) => [source, status]),
  ) as Partial<Record<ClinicalSource, SourceStatus>>;
  const insufficient = evaluated.filter((source) => source.reason !== null);
  const validTimestamps = evaluated
    .map(({ observedAt }) => observedAt)
    .filter((value): value is string => parseTimestamp(value) != null)
    .sort((left, right) => (parseTimestamp(left) ?? 0) - (parseTimestamp(right) ?? 0));
  const reviewRequirements: RReviewRequirement[] = insufficient.map((source) => ({
    source: source.source,
    sourceStatus: source.status,
    reason: source.reason ?? 'Información esperada insuficiente',
    ageMinutes: source.ageMinutes,
    owner: patient.reviewOwner?.trim() || 'Profesional responsable del relevo',
    state: 'open',
    enteredAt: options.failureStartedAt ?? options.now,
  }));
  const ruleLane: HandoffLane = baseLane === 'C' && reviewRequirements.length > 0 ? 'R' : baseLane;
  const { active, previous } = findOverrides(patient, shiftId);

  return {
    patientId: patient.patientId,
    clinicalStatus: clinicalStatus(baseLane),
    handoffLane: active?.newLane ?? ruleLane,
    baselineLane: baseLane,
    reasons: active
      ? [active.reason]
      : ruleLane === 'R'
        ? reviewRequirements.map(({ reason }) => reason)
        : baseLane === 'C'
          ? ['Sin novedades confirmadas con datos esperados vigentes']
          : [patient.change],
    classifiedAt: options.now,
    classifiedBy: active ? 'human' : 'rule',
    sourceStatuses,
    oldestRelevantSourceTimestamp: validTimestamps[0] ?? null,
    overrideReason: active?.reason,
    previousOverride: active ? previous : (previous ?? undefined),
    reviewRequirements: ruleLane === 'R' ? reviewRequirements : [],
  };
}

export function assessUnitDataHealth(
  classifications: readonly HandoffClassification[],
  integration: UnitIntegrationState,
  options: {
    now: string;
    previousStatus?: UnitDataHealth;
    config?: ExceptionHandoverProfileConfig;
  },
): UnitHealthAssessment {
  const config = options.config ?? BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG;
  const affectedSources = CLINICAL_SOURCES.filter((source) => {
    const status = integration.sourceStatuses?.[source];
    return status === 'missing' || status === 'stale' || status === 'unavailable';
  });

  if (integration.availability === 'unavailable') {
    return {
      status: 'unavailable',
      affectedSources,
      reason: 'Clasificación automática suspendida: fuente clínica no disponible',
      requiresExplicitRecovery: true,
    };
  }

  const rClassifications = classifications.filter(({ handoffLane }) => handoffLane === 'R');
  const ratioR = classifications.length > 0 ? rClassifications.length / classifications.length : 0;
  const oldestRAge = rClassifications.reduce((oldest, classification) => {
    const ages = classification.reviewRequirements
      .map(({ enteredAt }) => minutesBetween(enteredAt, options.now) ?? 0);
    return Math.max(oldest, ...ages, 0);
  }, 0);
  const criticalSourceFailed = config.criticalSources.some((source) => affectedSources.includes(source));
  const volumeWarning = rClassifications.length >= config.absoluteRWarning || ratioR >= config.ratioRWarning;
  const ageWarning = oldestRAge >= config.maxRAgeMinutes;
  const degradedTrigger = integration.availability === 'partial' || criticalSourceFailed || volumeWarning || ageWarning;

  if (degradedTrigger) {
    return {
      status: 'degraded',
      affectedSources: unique([
        ...affectedSources,
        ...rClassifications.flatMap(({ reviewRequirements }) => reviewRequirements.map(({ source }) => source)),
      ]),
      reason: 'Integración clínica degradada: revisar las excepciones dependientes de las fuentes afectadas',
      requiresExplicitRecovery: true,
    };
  }

  if (options.previousStatus && options.previousStatus !== 'healthy') {
    const stableFor = minutesBetween(integration.stableSince, options.now) ?? 0;
    if (!integration.recoveryConfirmedAt || stableFor < config.recoveryStabilityMinutes) {
      return {
        status: 'degraded',
        affectedSources,
        reason: 'Recuperación pendiente de confirmación estable',
        requiresExplicitRecovery: true,
      };
    }
  }

  return { status: 'healthy', affectedSources: [], reason: null, requiresExplicitRecovery: false };
}

export function classifyExceptionHandoverUnit(
  patients: readonly ExceptionPatientClassificationInput[],
  options: {
    now: string;
    shiftId?: string;
    integration?: UnitIntegrationState;
    previousStatus?: UnitDataHealth;
    lastKnownClassifications?: readonly HandoffClassification[];
    config?: ExceptionHandoverProfileConfig;
  },
): UnitClassificationResult {
  const integration = options.integration ?? { availability: 'available' };
  const lastKnownClassifications = [...(options.lastKnownClassifications ?? [])];

  if (integration.availability === 'unavailable') {
    return {
      unitDataHealth: assessUnitDataHealth([], integration, options),
      classifications: [],
      lastKnownClassifications,
      lastKnownClassifiedAt: lastKnownClassifications[0]?.classifiedAt ?? null,
      automaticClassificationSuspended: true,
    };
  }

  const classifications = patients.map((patient) => classifyExceptionHandoverPatient(patient, {
    now: options.now,
    shiftId: options.shiftId,
    unitSourceStatuses: integration.sourceStatuses,
    failureStartedAt: integration.failureStartedAt,
    config: options.config,
  }));

  return {
    unitDataHealth: assessUnitDataHealth(classifications, integration, options),
    classifications,
    lastKnownClassifications: classifications,
    lastKnownClassifiedAt: classifications[0]?.classifiedAt ?? null,
    automaticClassificationSuspended: false,
  };
}

export function groupExceptionHandoverPatients<T extends ExceptionPatientClassificationInput>(
  patients: readonly T[],
  classifications?: readonly HandoffClassification[],
): ExceptionHandoverGroups<T> {
  const byPatientId = new Map(classifications?.map((classification) => [classification.patientId, classification]));
  return patients.reduce<ExceptionHandoverGroups<T>>(
    (groups, patient) => {
      const lane = byPatientId?.get(patient.patientId)?.handoffLane ?? baselineLane(patient.status);
      if (lane === 'A') groups.critical.push(patient);
      if (lane === 'B') groups.changed.push(patient);
      if (lane === 'C') groups.unchanged.push(patient);
      if (lane === 'R') groups.review.push(patient);
      return groups;
    },
    { critical: [], changed: [], unchanged: [], review: [] },
  );
}

export function formatExceptionDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date(value));
}

export function buildExceptionSbar(patient: {
  name: string;
  bedLabel: string;
  change: string;
  unitName: string;
  lastSummaryAt: string;
  currentRisk: string;
  nextAction: string;
  owner: string;
  dueAt: string;
  contingency: { trigger: string; response: string };
}): ExceptionSbar {
  return {
    situation: `${patient.name}, cama ${patient.bedLabel}. ${patient.change}`,
    background: `Resumen previo de ${patient.unitName}, actualizado el ${formatExceptionDateTime(patient.lastSummaryAt)}.`,
    assessment: patient.currentRisk,
    recommendation: `${patient.nextAction} Responsable: ${patient.owner}. Objetivo: ${formatExceptionDateTime(patient.dueAt)}. Si ${patient.contingency.trigger}, ${patient.contingency.response}.`,
  };
}

export function buildExceptionSbarForClassification(
  patient: Parameters<typeof buildExceptionSbar>[0],
  classification: HandoffClassification,
): ExceptionSbar | null {
  return classification.handoffLane === 'A' || classification.handoffLane === 'B'
    ? buildExceptionSbar(patient)
    : null;
}

type EventDetails = {
  shiftId?: string;
  source?: ClinicalSource;
  reason?: string;
  targetAt?: string;
  receiverId?: string;
  criticalPoints?: readonly string[];
};

export function createExceptionReviewEvent(
  kind: ExceptionReviewEventKind,
  actor: ExceptionActorIdentity,
  recordedAt: string,
  patientId?: string,
  details: EventDetails = {},
): ExceptionReviewEvent {
  const shiftId = details.shiftId ?? DEFAULT_SHIFT_ID;
  const scope = patientId ?? details.source ?? 'unit';
  const criticalPoints = details.criticalPoints
    ?.map((point) => point.trim())
    .filter(Boolean) ?? [];
  if (kind === 'critical_check_back' && (criticalPoints.length < 1 || criticalPoints.length > 3)) {
    throw new Error('El check-back requiere entre uno y tres puntos críticos');
  }
  return {
    idempotencyKey: `exception-handoff:${shiftId}:${kind}:${scope}:${actor.userId}`,
    kind,
    actorId: actor.userId,
    actorName: actor.displayName,
    actorKind: actor.kind,
    recordedAt,
    shiftId,
    ...(patientId ? { patientId } : {}),
    ...(details.source ? { source: details.source } : {}),
    ...(details.reason?.trim() ? { reason: details.reason.trim() } : {}),
    ...(details.targetAt ? { targetAt: details.targetAt } : {}),
    ...(details.receiverId ? { receiverId: details.receiverId } : {}),
    ...(criticalPoints.length > 0 ? { criticalPoints } : {}),
  };
}

export function appendUniqueExceptionEvent(
  events: readonly ExceptionReviewEvent[],
  event: ExceptionReviewEvent,
): ExceptionReviewEvent[] {
  return events.some(({ idempotencyKey }) => idempotencyKey === event.idempotencyKey)
    ? [...events]
    : [...events, event];
}

export function createHandoffOverride(input: {
  patientId: string;
  previousLane: HandoffLane;
  newLane: HandoffLane;
  reason: string;
  professional: ExceptionActorIdentity;
  shiftId: string;
  recordedAt: string;
  sourceStatuses: Partial<Record<ClinicalSource, SourceStatus>>;
}): HandoffOverride {
  const reason = input.reason.trim();
  if (!reason) throw new Error('El override requiere un motivo clínico');
  return {
    idempotencyKey: `exception-handoff:${input.shiftId}:override:${input.patientId}:${input.professional.userId}:${input.newLane}`,
    patientId: input.patientId,
    previousLane: input.previousLane,
    newLane: input.newLane,
    reason,
    professionalId: input.professional.userId,
    professionalName: input.professional.displayName,
    shiftId: input.shiftId,
    recordedAt: input.recordedAt,
    sourceStatuses: { ...input.sourceStatuses },
  };
}

export function appendUniqueOverride(
  overrides: readonly HandoffOverride[],
  override: HandoffOverride,
): HandoffOverride[] {
  return overrides.some(({ idempotencyKey }) => idempotencyKey === override.idempotencyKey)
    ? [...overrides]
    : [...overrides, override];
}

export function getPatientTransferStatus(
  patientId: string,
  events: readonly ExceptionReviewEvent[],
): TransferStatus {
  const patientEvents = events.filter((event) => event.patientId === patientId);
  if (patientEvents.some(({ kind }) => kind === 'critical_escalated')) return 'escalated';
  if (patientEvents.some(({ kind }) => kind === 'critical_check_back')) return 'completed';
  return 'pending-acknowledgement';
}

export function calculateCheckBackMetrics(
  classifications: readonly HandoffClassification[],
  events: readonly ExceptionReviewEvent[],
): CheckBackMetrics {
  const required = classifications.filter(({ handoffLane }) => handoffLane === 'A');
  const completed = required.filter(({ patientId }) => getPatientTransferStatus(patientId, events) === 'completed');
  const clarificationCount = unique(events
    .filter(({ kind }) => kind === 'critical_clarification')
    .map(({ patientId }) => patientId)
    .filter((patientId): patientId is string => Boolean(patientId))).length;

  return {
    requiredCheckBacks: required.length,
    completedCheckBacks: completed.length,
    pendingCheckBacks: required.length - completed.length,
    bypassCount: 0,
    bypassRate: 0,
    clarificationCount,
  };
}

export function calculateRMetrics(
  classifications: readonly HandoffClassification[],
  events: readonly ExceptionReviewEvent[],
  now: string,
): RMetrics {
  const currentR = classifications.filter(({ handoffLane }) => handoffLane === 'R');
  const durations = currentR.flatMap(({ reviewRequirements }) =>
    reviewRequirements.map(({ enteredAt }) => minutesBetween(enteredAt, now) ?? 0));
  const resolvedIds = unique(events
    .filter(({ kind }) => kind === 'r_resolved')
    .map(({ patientId }) => patientId)
    .filter((patientId): patientId is string => Boolean(patientId)));
  const transferredIds = unique(events
    .filter(({ kind }) => kind === 'r_transferred')
    .map(({ patientId }) => patientId)
    .filter((patientId): patientId is string => Boolean(patientId)));

  return {
    countR: currentR.length,
    ratioR: classifications.length > 0 ? currentR.length / classifications.length : 0,
    oldestRAge: durations.length > 0 ? Math.max(...durations) : 0,
    affectedSources: unique(currentR.flatMap(({ reviewRequirements }) => reviewRequirements.map(({ source }) => source))),
    meanTimeInR: durations.length > 0 ? durations.reduce((sum, age) => sum + age, 0) / durations.length : 0,
    resolvedR: resolvedIds.length,
    transferredUnresolvedR: transferredIds.length,
  };
}

export function assessHandoffClosure(
  classifications: readonly HandoffClassification[],
  events: readonly ExceptionReviewEvent[],
  unitHealth: UnitDataHealth,
): HandoffClosureAssessment {
  if (unitHealth === 'unavailable') {
    const hasIncidentAcknowledgement = events.some(({ kind }) => kind === 'unit_incident_acknowledgement');
    const hasOutgoingTransfer = events.some(({ kind }) => kind === 'degraded_outgoing_transfer');
    const hasIncomingAcknowledgement = events.some(({ kind }) => kind === 'degraded_incoming_acknowledgement');
    const blockingReasons = [
      ...(!hasIncidentAcknowledgement ? ['Falta reconocer la incidencia de unidad'] : []),
      ...(!hasOutgoingTransfer ? ['Falta registrar el relevo degradado saliente'] : []),
      ...(!hasIncomingAcknowledgement ? ['Falta el reconocimiento del equipo receptor'] : []),
    ];
    return { canClose: blockingReasons.length === 0, blockingReasons };
  }

  const pendingCritical = classifications
    .filter(({ handoffLane }) => handoffLane === 'A')
    .filter(({ patientId }) => getPatientTransferStatus(patientId, events) === 'pending-acknowledgement');
  const unresolvedR = classifications
    .filter(({ handoffLane }) => handoffLane === 'R')
    .filter(({ patientId }) => {
      const resolved = events.some((event) => event.patientId === patientId && event.kind === 'r_resolved');
      const transferred = events.some((event) =>
        event.patientId === patientId &&
        event.kind === 'r_transferred' &&
        event.actorKind === 'incoming' &&
        Boolean(event.reason?.trim()) &&
        Boolean(event.targetAt) &&
        Boolean(event.receiverId));
      return !resolved && !transferred;
    });
  const blockingReasons = [
    ...(pendingCritical.length > 0 ? ['Hay prioridades A sin check-back o escalado'] : []),
    ...(unresolvedR.length > 0 ? ['Hay pacientes R ocultos, sin resolver o sin responsable receptor'] : []),
  ];
  return { canClose: blockingReasons.length === 0, blockingReasons };
}

export function validateDegradedUnitTransfer(value: DegradedUnitTransfer): boolean {
  return Boolean(
    value.receiverId.trim() &&
    parseTimestamp(value.recordedAt) != null &&
    value.priorityPatientIds.every((patientId) => patientId.trim()) &&
    value.changedPatientIds.every((patientId) => patientId.trim()) &&
    value.criticalPendings.every((pending) => pending.trim()),
  );
}

export function isInteractionBudgetExceeded(
  route: HandoffLane | 'degraded',
  interactions: number,
  config: ExceptionHandoverProfileConfig = BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG,
): boolean {
  return interactions > config.interactionBudgets[route];
}

export { BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG, CLINICAL_SOURCES };
export type { ClinicalSource, ExceptionHandoverProfileConfig };
