import {
  BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG,
  CLINICAL_SOURCES,
  type ClinicalSource,
  type ExceptionHandoverProfileConfig,
} from '@/src/config/profiles/exceptionHandover';
import { sha256 } from 'js-sha256';
import { z } from 'zod';
import { zContingencyPlan, zOxygen, zPendingTask, zRiskFlags, zRiskItem, zVitals } from '@/src/validation/schemas';
import type { ContingencyPlan, OxygenTherapy, PendingTaskSummary, RiskFlags, RiskItem, VitalsSnapshot } from '@/src/types/handover';
import { selectNews2Temperature } from './news2-input';
import { resolveSupplementalOxygen } from './oxygen';

export type ClinicalStatus = 'stable' | 'watcher' | 'unstable' | 'unverified';
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
  reference?: string;
  version?: string;
  patientId?: string;
  unitId?: string;
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
  vitals?: VitalsSnapshot;
  oxygenTherapy?: OxygenTherapy;
  risks?: RiskFlags;
  risksStructured?: readonly RiskItem[];
  pendingTasks?: readonly PendingTaskSummary[];
  contingencyPlan?: ContingencyPlan;
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
  scopeKey?: string;
};

export type HandoffClassification = {
  patientId: string;
  clinicalStatus: ClinicalStatus;
  handoffLane: HandoffLane;
  baselineLane: HandoffLane;
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
  context?: ExceptionHandoverContext;
  patientId?: string;
  source?: ClinicalSource;
  reason?: string;
  targetAt?: string;
  receiverId?: string;
  acknowledgesKey?: string;
  manifestHash?: string;
  criticalPoints?: string[];
};

export type ExceptionHandoverContext = { key: string; revision: number; shiftId: string };

export function buildExceptionHandoverContextKey(
  shiftId: string,
  viewScope: string,
  members: readonly { patientId: string; unitId: string }[],
  classifications: readonly HandoffClassification[],
): string {
  const group = members.map(({ patientId, unitId }) => [patientId, unitId] as const)
    .sort(([leftId, leftUnit], [rightId, rightUnit]) =>
      leftId.localeCompare(rightId) || leftUnit.localeCompare(rightUnit));
  const lanes = classifications.map(({ patientId, handoffLane, clinicalStatus, reasons, sourceStatuses, reviewRequirements }) =>
    [patientId, handoffLane, clinicalStatus, [...reasons].sort(),
      Object.entries(sourceStatuses).sort(([left], [right]) => left.localeCompare(right)),
      reviewRequirements.map(({ source, sourceStatus, reason, owner, state }) =>
        [source, sourceStatus, reason, owner, state]).sort(([left], [right]) => left.localeCompare(right))] as const)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  return sha256(JSON.stringify({ shiftId, viewScope, units: [...new Set(members.map(({ unitId }) => unitId))].sort(), group, lanes }));
}

export function buildExceptionScopeKey(shiftId: string, viewScope: string,
  members: readonly { patientId: string; unitId: string }[],
  snapshots: readonly ComparableSnapshot[] = []): string {
  return sha256(JSON.stringify({ shiftId, viewScope, members: [...members]
    .map(({ patientId, unitId }) => [patientId, unitId])
    .sort(([leftId, leftUnit], [rightId, rightUnit]) =>
      leftId.localeCompare(rightId) || leftUnit.localeCompare(rightUnit)),
    evidence: snapshots.map((snapshot) => [snapshot.patientId, snapshot.unitId, snapshot.sources])
      .sort(([left], [right]) => String(left).localeCompare(String(right))) }));
}

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

export type ComparableField = 'observationLevel' | 'activeRisks' | 'risks' | 'risksStructured' |
  'vitals' | 'oxygenTherapy' | 'plan' | 'pendingTasks' | 'contingencyPlan';
export type ComparableSource = {
  availability: SourceStatus;
  reference?: string;
  version?: string;
  observedAt?: string;
  coverage: ComparableField[];
  contentHash?: string;
};
export type ComparableSnapshot = {
  version: 1;
  id: string;
  patientId: string;
  unitId: string;
  shiftId: string;
  sources: Partial<Record<ClinicalSource, ComparableSource>>;
};
export type AcceptedComparableReference = {
  version: 1;
  context: ExceptionHandoverContext;
  manifestHash: string;
  outgoingKey: string;
  incomingKey: string;
  acceptedBy: string;
  acceptedAt: string;
  expiresAt: string;
  snapshots: ComparableSnapshot[];
};
export type FrozenComparableManifest = {
  context: ExceptionHandoverContext;
  snapshots: ComparableSnapshot[];
  hash: string;
};

const SOURCE_FIELDS: Readonly<Partial<Record<ClinicalSource, readonly ComparableField[]>>> = {
  'direct-assessment': ['observationLevel', 'activeRisks', 'risks', 'risksStructured'],
  'observation-record': ['vitals', 'oxygenTherapy'],
  'care-plan': ['plan', 'pendingTasks', 'contingencyPlan'],
};
const FIELD_SCHEMAS = {
  observationLevel: z.enum(['routine', 'enhanced', 'constant']),
  activeRisks: z.array(z.string().trim().min(1)),
  risks: zRiskFlags,
  risksStructured: z.array(zRiskItem),
  vitals: zVitals,
  oxygenTherapy: zOxygen,
  plan: z.object({
    requiresMedicationVerification: z.boolean().optional(),
    requiresDirectAssessment: z.boolean().optional(),
    requiresLeaveReview: z.boolean().optional(),
    restrictiveInterventionReviewDue: z.boolean().optional(),
  }),
  pendingTasks: z.array(zPendingTask),
  contingencyPlan: zContingencyPlan,
} satisfies Record<ComparableField, z.ZodType>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

const contentHash = (value: unknown): string => sha256(JSON.stringify(canonical(value)));

const VITAL_VALUES = ['hr', 'rr', 'tempC', 'spo2', 'sbp', 'dbp', 'glucoseMgDl', 'glucoseMmolL', 'avpu'] as const;

function hasComparableInput(field: ComparableField, value: unknown, patient: ExceptionPatientClassificationInput): boolean {
  if (value === undefined) return false;
  if (field !== 'vitals' && field !== 'oxygenTherapy') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const entries = Object.entries(value);
  if (field === 'vitals') return VITAL_VALUES.some((key) => entries.some(([name, entry]) =>
    name === key && entry !== undefined)) || typeof patient.vitals?.o2 === 'boolean';
  if (field === 'oxygenTherapy') return entries.some(([name, entry]) =>
    ((name === 'flowLMin' || name === 'fio2') && entry !== undefined) ||
    (name === 'device' && typeof entry === 'string' && Boolean(entry.trim())));
  return true;
}

function comparableValue(field: ComparableField, value: unknown, patient: ExceptionPatientClassificationInput): unknown | undefined {
  const parsed = FIELD_SCHEMAS[field].safeParse(value);
  if (!parsed.success) return undefined;
  if (field === 'vitals') {
    const vitals = zVitals.parse(value);
    const projected: Record<string, unknown> = Object.fromEntries(VITAL_VALUES
      .filter((key) => vitals[key] !== undefined).map((key) => [key, vitals[key]]));
    if (typeof patient.vitals?.o2 === 'boolean') {
      projected.supplementalOxygen = resolveSupplementalOxygen(patient.oxygenTherapy, patient.vitals.o2);
    }
    return Object.keys(projected).length ? projected : undefined;
  }
  const projected = canonical(parsed.data);
  if (field === 'oxygenTherapy' && projected && typeof projected === 'object' && !Array.isArray(projected)) {
    const therapy: Record<string, unknown> = Object.fromEntries(Object.entries(projected));
    if (typeof therapy.device === 'string') {
      therapy.device = therapy.device.trim();
      if (!therapy.device) delete therapy.device;
    }
    return Object.keys(therapy).length ? therapy : undefined;
  }
  return projected && typeof projected === 'object' && !Array.isArray(projected) &&
    !Object.keys(projected).length ? undefined : projected;
}

export function buildComparableSnapshot(
  patient: ExceptionPatientClassificationInput,
  unitId: string,
  now: string,
  config: ExceptionHandoverProfileConfig = BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG,
  unitSourceStatuses?: Partial<Record<ClinicalSource, SourceStatus>>,
): ComparableSnapshot {
  const fields = {
    observationLevel: patient.observationLevel, activeRisks: patient.activeRisks,
    risks: patient.risks, risksStructured: patient.risksStructured,
    vitals: patient.vitals ? { ...patient.vitals, tempC: selectNews2Temperature(patient.vitals) } : undefined,
    oxygenTherapy: patient.oxygenTherapy, plan: patient.plan,
    pendingTasks: patient.pendingTasks, contingencyPlan: patient.contingencyPlan,
  };
  const sources: ComparableSnapshot['sources'] = {};
  for (const source of expectedSourcesForPatient(patient, config)) {
    const evidence = patient.sourceEvidence?.[source];
    const coverage = (SOURCE_FIELDS[source] ?? []).filter((field) => hasComparableInput(field, fields[field], patient));
    const observed = parseTimestamp(evidence?.observedAt);
    const current = parseTimestamp(now);
    const projectedFields = coverage.map((field) => [field, comparableValue(field, fields[field], patient)] as const);
    const validFields = projectedFields.every(([, value]) => value !== undefined) &&
      (!coverage.includes('pendingTasks') || patient.pendingTasks?.every((task) =>
        task.category !== undefined && task.priority !== undefined && task.status !== undefined));
    const unitStatus = unitSourceStatuses?.[source];
    const availability: SourceStatus = unitStatus && unitStatus !== 'current'
      ? unitStatus
      : !evidence || evidence.status === 'missing' ? 'missing'
      : evidence.status === 'unavailable' || evidence.verifiable === false ? 'unavailable'
        : evidence.coherent === false || !evidence.reference?.trim() ||
          evidence.patientId !== patient.patientId || evidence.unitId !== unitId || !unitId.trim() ||
          observed === null || current === null || observed > current || !coverage.length || !validFields ? 'missing'
          : evidence.status === 'stale' || current - observed > config.expectedFreshnessMinutes[source] * MINUTE_MS
            ? 'stale' : 'current';
    sources[source] = {
      availability,
      ...(evidence?.reference?.trim() ? { reference: evidence.reference.trim() } : {}),
      ...(evidence?.version ? { version: evidence.version } : {}),
      ...(evidence?.observedAt ? { observedAt: evidence.observedAt } : {}),
      coverage,
      ...(validFields && coverage.length ? { contentHash: contentHash(Object.fromEntries(projectedFields)) } : {}),
    };
  }
  const shiftId = patient.shiftId ?? DEFAULT_SHIFT_ID;
  return { version: 1, id: contentHash({ patientId: patient.patientId, unitId, shiftId, sources }),
    patientId: patient.patientId, unitId, shiftId, sources };
}

export function selectAcceptedComparableReference(
  references: readonly AcceptedComparableReference[], patientId: string, unitId: string,
  currentShiftId?: string,
): AcceptedComparableReference | null {
  return [...references].filter((reference) => reference.context.shiftId !== currentShiftId && reference.snapshots.some((snapshot) =>
    snapshot.patientId === patientId && snapshot.unitId === unitId))
    .sort((left, right) => Date.parse(right.acceptedAt) - Date.parse(left.acceptedAt))[0] ?? null;
}

export function compareAcceptedSnapshot(
  current: ComparableSnapshot,
  accepted: AcceptedComparableReference | null,
  now: string,
): { handoffLane: 'B' | 'C' | 'R'; reasons: string[] } {
  const nowMs = parseTimestamp(now);
  const acceptedMs = parseTimestamp(accepted?.acceptedAt);
  const prior = accepted?.snapshots.find((snapshot) =>
    snapshot.patientId === current.patientId && snapshot.unitId === current.unitId);
  if (!accepted || !prior || accepted.version !== 1 || prior.version !== current.version ||
      acceptedMs === null || nowMs === null || acceptedMs > nowMs ||
      (parseTimestamp(accepted.expiresAt) ?? -1) <= nowMs ||
      accepted.manifestHash !== contentHash(accepted.snapshots) ||
      !accepted.acceptedBy.trim() || !accepted.outgoingKey.trim() || !accepted.incomingKey.trim() ||
      accepted.context.shiftId === current.shiftId) {
    return { handoffLane: 'R', reasons: ['No hay referencia previa aceptada y vigente'] };
  }
  const sources = Object.keys(current.sources) as ClinicalSource[];
  if (sources.length === 0 || sources.length !== Object.keys(prior.sources).length || sources.some((source) => {
    const next = current.sources[source];
    const previous = prior.sources[source];
    return next?.availability !== 'current' || previous?.availability !== 'current' ||
      !next.contentHash || !previous.contentHash || !next.reference || !previous.reference ||
      next.version !== previous.version ||
      JSON.stringify(next.coverage) !== JSON.stringify(previous.coverage) ||
      (parseTimestamp(next.observedAt) ?? -1) < acceptedMs ||
      (parseTimestamp(next.observedAt) ?? Infinity) > nowMs ||
      (parseTimestamp(previous.observedAt) ?? Infinity) > acceptedMs;
  })) return { handoffLane: 'R', reasons: ['Fuentes comparables insuficientes o fuera de orden'] };
  return sources.some((source) => current.sources[source]?.contentHash !== prior.sources[source]?.contentHash)
    ? { handoffLane: 'B', reasons: ['Diferencia en campos comparables verificados'] }
    : { handoffLane: 'C', reasons: ['Sin diferencias en los campos comparables cubiertos'] };
}

export function freezeComparableManifest(
  context: ExceptionHandoverContext,
  snapshots: readonly ComparableSnapshot[],
): FrozenComparableManifest {
  const ordered = [...snapshots].sort((left, right) => left.patientId.localeCompare(right.patientId) ||
    left.unitId.localeCompare(right.unitId));
  if (!ordered.length || new Set(ordered.map(({ patientId, unitId }) => `${patientId}\u0000${unitId}`)).size !== ordered.length ||
      ordered.some(({ shiftId, patientId, unitId }) => shiftId !== context.shiftId || !patientId || !unitId)) {
    throw new Error('Invalid comparable manifest membership');
  }
  return { context, snapshots: ordered, hash: contentHash(ordered) };
}

export function acceptComparableManifest(
  frozen: FrozenComparableManifest,
  current: readonly ComparableSnapshot[],
  outgoing: ExceptionReviewEvent,
  incoming: ExceptionReviewEvent,
  retentionDays = 1,
): AcceptedComparableReference {
  const now = parseTimestamp(incoming.recordedAt);
  const sent = parseTimestamp(outgoing.recordedAt);
  const compared = freezeComparableManifest(frozen.context, current);
  if (frozen.hash !== compared.hash || frozen.hash !== contentHash(frozen.snapshots) ||
      outgoing.kind !== 'outgoing_transfer' || incoming.kind !== 'incoming_attestation' ||
      outgoing.manifestHash !== frozen.hash || incoming.manifestHash !== frozen.hash ||
      outgoing.actorKind !== 'outgoing' || incoming.actorKind !== 'incoming' ||
      incoming.acknowledgesKey !== outgoing.idempotencyKey || outgoing.actorId === incoming.actorId ||
      outgoing.context?.key !== frozen.context.key || incoming.context?.key !== frozen.context.key ||
      outgoing.context.revision !== frozen.context.revision || incoming.context.revision !== frozen.context.revision ||
      now === null || sent === null || now < sent ||
      !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
    throw new Error('Comparable manifest acceptance is not verifiable');
  }
  return {
    version: 1, context: frozen.context, manifestHash: frozen.hash,
    outgoingKey: outgoing.idempotencyKey, incomingKey: incoming.idempotencyKey,
    acceptedBy: incoming.actorId, acceptedAt: incoming.recordedAt,
    expiresAt: new Date(now + retentionDays * 86_400_000).toISOString(),
    snapshots: frozen.snapshots,
  };
}

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
    overrideAsOf?: string;
    config?: ExceptionHandoverProfileConfig;
    candidate?: { unitId: string; scopeKey: string; acceptedReference: AcceptedComparableReference | null };
  },
): HandoffClassification {
  const config = options.config ?? BEHAVIORAL_HEALTH_EXCEPTION_HANDOVER_CONFIG;
  const shiftId = options.shiftId ?? patient.shiftId ?? DEFAULT_SHIFT_ID;
  const snapshot = options.candidate ? buildComparableSnapshot({ ...patient, shiftId },
    options.candidate.unitId, options.now, config, options.unitSourceStatuses) : null;
  const comparison = snapshot ? compareAcceptedSnapshot(snapshot, options.candidate?.acceptedReference ?? null, options.now) : null;
  const baseLane: HandoffLane = comparison?.handoffLane ?? baselineLane(patient.status);
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
    snapshot ? Object.entries(snapshot.sources).map(([source, evidence]) => [source, evidence?.availability]) :
      evaluated.map(({ source, status }) => [source, status]),
  ) as Partial<Record<ClinicalSource, SourceStatus>>;
  const insufficient = evaluated.filter((source) => source.reason !== null);
  const validTimestamps = evaluated
    .map(({ observedAt }) => observedAt)
    .filter((value): value is string => parseTimestamp(value) != null)
    .sort((left, right) => (parseTimestamp(left) ?? 0) - (parseTimestamp(right) ?? 0));
  const reviewRequirements: RReviewRequirement[] = (comparison?.handoffLane === 'R'
    ? expectedSources.map((source) => ({ source, status: snapshot?.sources[source]?.availability ?? 'missing',
      reason: comparison.reasons[0], ageMinutes: null })) : insufficient).map((source) => ({
    source: source.source,
    sourceStatus: source.status,
    reason: source.reason ?? 'Información esperada insuficiente',
    ageMinutes: source.ageMinutes,
    owner: patient.reviewOwner?.trim() || 'Profesional responsable del relevo',
    state: 'open',
    enteredAt: options.failureStartedAt ?? options.now,
  }));
  const ruleLane: HandoffLane = comparison ? comparison.handoffLane : baseLane === 'C' && reviewRequirements.length > 0 ? 'R' : baseLane;
  const found = findOverrides(patient, shiftId);
  const active = options.candidate ? [...(patient.previousOverrides ?? [])].reverse().find((override) =>
    override.shiftId === shiftId && override.scopeKey === options.candidate?.scopeKey && override.newLane === 'A' &&
    (parseTimestamp(override.recordedAt) ?? Infinity) <= (parseTimestamp(options.overrideAsOf ?? options.now) ?? -1) &&
    Boolean(override.reason.trim()) && Boolean(override.professionalId.trim())) : found.active;
  const previous = found.previous;

  return {
    patientId: patient.patientId,
    clinicalStatus: active?.newLane === 'A' ? 'unstable' : (options.candidate && ruleLane === 'R') || baseLane === 'R'
      ? 'unverified' : clinicalStatus(baseLane),
    handoffLane: active?.newLane ?? ruleLane,
    baselineLane: baseLane,
    reasons: active
      ? [active.reason]
      : comparison ? comparison.reasons
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
    overrideAsOf?: string;
    previousStatus?: UnitDataHealth;
    lastKnownClassifications?: readonly HandoffClassification[];
    config?: ExceptionHandoverProfileConfig;
    candidate?: {
      scopeKey: string;
      units: ReadonlyMap<string, string>;
      acceptedReferences: readonly AcceptedComparableReference[];
    };
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
    overrideAsOf: options.overrideAsOf,
    unitSourceStatuses: integration.sourceStatuses,
    failureStartedAt: integration.failureStartedAt,
    config: options.config,
    ...(options.candidate ? { candidate: { unitId: options.candidate.units.get(patient.patientId) ?? '',
      scopeKey: options.candidate.scopeKey,
      acceptedReference: selectAcceptedComparableReference(options.candidate.acceptedReferences,
        patient.patientId, options.candidate.units.get(patient.patientId) ?? '',
        options.shiftId ?? patient.shiftId ?? DEFAULT_SHIFT_ID) } } : {}),
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
  context?: ExceptionHandoverContext;
  source?: ClinicalSource;
  reason?: string;
  targetAt?: string;
  receiverId?: string;
  acknowledgesKey?: string;
  manifestHash?: string;
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
    idempotencyKey: `exception-handoff:${shiftId}:${kind}:${scope}:${actor.userId}${details.context ? `:${details.context.key}:${details.context.revision}` : ''}${details.acknowledgesKey ? `:ack:${sha256(details.acknowledgesKey)}` : ''}${details.manifestHash ? `:manifest:${details.manifestHash}` : ''}`,
    kind,
    actorId: actor.userId,
    actorName: actor.displayName,
    actorKind: actor.kind,
    recordedAt,
    shiftId,
    ...(details.context ? { context: details.context } : {}),
    ...(patientId ? { patientId } : {}),
    ...(details.source ? { source: details.source } : {}),
    ...(details.reason?.trim() ? { reason: details.reason.trim() } : {}),
    ...(details.targetAt ? { targetAt: details.targetAt } : {}),
    ...(details.receiverId ? { receiverId: details.receiverId } : {}),
    ...(details.acknowledgesKey ? { acknowledgesKey: details.acknowledgesKey } : {}),
    ...(details.manifestHash ? { manifestHash: details.manifestHash } : {}),
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
  scopeKey?: string;
}): HandoffOverride {
  const reason = input.reason.trim();
  if (!reason) throw new Error('El override requiere un motivo clínico');
  return {
    idempotencyKey: `exception-handoff:${input.shiftId}:override:${input.patientId}:${input.professional.userId}:${input.newLane}${input.scopeKey ? `:${input.scopeKey}` : ''}`,
    patientId: input.patientId,
    previousLane: input.previousLane,
    newLane: input.newLane,
    reason,
    professionalId: input.professional.userId,
    professionalName: input.professional.displayName,
    shiftId: input.shiftId,
    recordedAt: input.recordedAt,
    sourceStatuses: { ...input.sourceStatuses },
    ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
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
  context?: ExceptionHandoverContext,
): TransferStatus {
  const patientEvents = events.filter((event) => event.patientId === patientId && (!context || eventMatchesContext(event, context)));
  if (patientEvents.some(({ kind }) => kind === 'critical_escalated')) return 'escalated';
  if (patientEvents.some(({ kind }) => kind === 'critical_check_back')) return 'completed';
  return 'pending-acknowledgement';
}

function eventMatchesContext(event: ExceptionReviewEvent, context: ExceptionHandoverContext): boolean {
  return event.shiftId === context.shiftId && event.context?.key === context.key &&
    event.context.revision === context.revision;
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
  context: ExceptionHandoverContext,
): HandoffClosureAssessment {
  const shiftEvents = events.filter((event) => event.shiftId === context.shiftId);
  if (unitHealth === 'unavailable') {
    const hasIncidentAcknowledgement = shiftEvents.some(({ kind }) => kind === 'unit_incident_acknowledgement');
    const hasOutgoingTransfer = shiftEvents.some(({ kind }) => kind === 'degraded_outgoing_transfer');
    const hasIncomingAcknowledgement = shiftEvents.some(({ kind }) => kind === 'degraded_incoming_acknowledgement');
    const blockingReasons = [
      ...(!hasIncidentAcknowledgement ? ['Falta reconocer la incidencia de unidad'] : []),
      ...(!hasOutgoingTransfer ? ['Falta registrar el relevo degradado saliente'] : []),
      ...(!hasIncomingAcknowledgement ? ['Falta el reconocimiento del equipo receptor'] : []),
    ];
    return { canClose: blockingReasons.length === 0, blockingReasons };
  }

  const currentEvents = shiftEvents.filter((event) => eventMatchesContext(event, context));

  const pendingCritical = classifications
    .filter(({ handoffLane }) => handoffLane === 'A')
    .filter(({ patientId }) => getPatientTransferStatus(patientId, currentEvents) === 'pending-acknowledgement');
  const pendingBriefs = classifications
    .filter(({ handoffLane }) => handoffLane === 'B')
    .filter(({ patientId }) => !currentEvents.some((event) => event.patientId === patientId && event.kind === 'brief_review'));
  const pendingCollective = classifications.some(({ handoffLane }) => handoffLane === 'C') &&
    !currentEvents.some((event) => event.kind === 'unchanged_group_review' && !event.patientId);
  const unresolvedR = classifications
    .filter(({ handoffLane }) => handoffLane === 'R')
    .filter(({ patientId }) => {
      const resolved = currentEvents.some((event) => event.patientId === patientId && event.kind === 'r_resolved');
      const transferred = currentEvents.some((event) =>
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
    ...(pendingBriefs.length > 0 ? ['Hay pacientes B sin revisión de relevo breve'] : []),
    ...(pendingCollective ? ['Falta la revisión colectiva del grupo C'] : []),
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
