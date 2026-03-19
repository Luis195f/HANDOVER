import {
  getSpecialtyOverlayDefinition,
  getUnitProfileDefinition,
  resolveProfileContext,
} from '../config/profiles';
import type {
  DeviceSummary,
  PendingTaskSummary,
  RiskFlags,
  RiskItem,
  VitalsSnapshot,
} from '../types/handover';
import type {
  ContextualPriorityDimension,
  ContextualPrioritySignal,
  ProfileContext,
  SpecialtyOverlayId,
  UnitProfileId,
} from '../types/profile';
import { computeNEWS2, type NEWS2Breakdown } from './news2';

export type MPACPriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export type MPACReasonCode =
  | 'HIGH_NEWS2'
  | 'INVASIVE_DEVICE'
  | 'RECENT_INCIDENT'
  | 'PENDING_URGENT_TASK'
  | 'HIGH_RISK_FLAGS'
  | 'DEPENDENCY_SURVEILLANCE'
  | 'PROFILE_CONTEXT'
  | 'MANUAL_OVERRIDE';

export type MPACBaseDimension =
  | 'instability'
  | 'deterioration-risk'
  | 'dependency'
  | 'time-critical'
  | 'therapeutic-load';

export interface MPACPriorityOverride {
  level: MPACPriorityLevel;
  rationale: string;
  by?: string;
  role?: string;
  at?: string;
}

export interface MPACInput {
  patientId: string;
  displayName: string;
  bedLabel?: string;
  vitals: VitalsSnapshot;
  devices: DeviceSummary[];
  risks: RiskFlags;
  risksStructured?: RiskItem[];
  pendingTasks: PendingTaskSummary[];
  lastIncidentAt?: string | null;
  recentIncidentFlag?: boolean;
  referenceTime?: string | number | Date;
  unitId?: string;
  specialtyId?: string | null;
  profileContext?: ProfileContext;
  activeContextLabels?: readonly string[];
  manualOverride?: MPACPriorityOverride;
}

export interface MPACResolvedInput extends MPACInput {
  profileContext: ProfileContext;
  activeContextLabels: readonly string[];
}

export interface MPACDimensionContribution {
  label: string;
  score: number;
  source: 'core';
  details?: readonly string[];
}

export interface MPACDimensionScore {
  key: MPACBaseDimension;
  label: string;
  score: number;
  contributions: readonly MPACDimensionContribution[];
}

export interface MPACContextModifier {
  signalId: string;
  label: string;
  dimension: ContextualPriorityDimension;
  source: 'unit-profile' | 'specialty-overlay';
  profileId?: UnitProfileId | SpecialtyOverlayId;
  weight: number;
  contribution: number;
  applied: boolean;
  note: string;
}

export interface MPACFutureExtensionResult {
  adapterId: string;
  scoreDelta: number;
  note: string;
}

export interface MPACFutureExtension {
  id: string;
  label: string;
  augment(input: MPACResolvedInput, result: MPACResult): MPACFutureExtensionResult | null;
}

export interface MPACExplanation {
  engine: 'mpac-v1-hybrid-rules';
  version: 1;
  sourceData: readonly string[];
  clinicalChange: readonly string[];
  pendingCritical: readonly string[];
  activeContext: {
    unitId?: string;
    specialtyId?: string;
    unitProfileId: UnitProfileId | null;
    specialtyOverlayIds: readonly SpecialtyOverlayId[];
    activeProfileIds: readonly string[];
    labels: readonly string[];
    usesCoreFallback: boolean;
    hasHumanSpecialtyOverride: boolean;
  };
  coreDimensions: readonly MPACDimensionScore[];
  modifiers: readonly MPACContextModifier[];
  override?: MPACPriorityOverride;
  futureExtension?: MPACFutureExtensionResult;
}

export interface MPACResult {
  patientId: string;
  displayName: string;
  bedLabel?: string;
  news2Score: number;
  totalScore: number;
  baseScore: number;
  level: MPACPriorityLevel;
  baseLevel: MPACPriorityLevel;
  reasons: MPACReasonCode[];
  reasonSummary: string;
  pendingCriticalTasksCount: number;
  explanation: MPACExplanation;
  manualOverride?: MPACPriorityOverride;
}

const INCIDENT_RECENCY_THRESHOLD_MS = 18 * 60 * 60 * 1000;
const DUE_SOON_THRESHOLD_MS = 2 * 60 * 60 * 1000;

const DIMENSION_LABELS: Record<MPACBaseDimension, string> = {
  instability: 'Inestabilidad actual',
  'deterioration-risk': 'Riesgo de deterioro',
  dependency: 'Dependencia y vigilancia',
  'time-critical': 'Criticidad temporal',
  'therapeutic-load': 'Carga terapeutica',
};

const RISK_LABELS: Record<string, string> = {
  fall: 'caidas',
  pressureUlcer: 'UPP',
  isolation: 'aislamiento',
  seizure: 'convulsiones',
  bleeding: 'sangrado',
  aspiration: 'broncoaspiracion',
  airway: 'via aerea',
  infection: 'infeccion',
  delirium: 'delirium',
};

const LEVEL_SCORE_FLOORS: Record<MPACPriorityLevel, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 0,
};

const PROFILE_SIGNAL_MULTIPLIER: Record<'unit-profile' | 'specialty-overlay', number> = {
  'unit-profile': 0.25,
  'specialty-overlay': 0.35,
};

interface IncidentRecency {
  recent: boolean;
  incidentMs: number | null;
}

interface TaskAssessment {
  id: string;
  title: string;
  priorityLabel: string;
  isOpen: boolean;
  isCritical: boolean;
  isUrgent: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  isReevaluation: boolean;
}

const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;

const parseTimeMs = (value?: string | number | Date | null): number | null => {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

function getReferenceTimeMs(input: Pick<MPACInput, 'referenceTime'>): number {
  return parseTimeMs(input.referenceTime) ?? Date.now();
}

export function getIncidentSortTime(input: Pick<MPACInput, 'lastIncidentAt' | 'recentIncidentFlag' | 'referenceTime'>): number | null {
  if (input.recentIncidentFlag) {
    return getReferenceTimeMs(input);
  }

  return parseTimeMs(input.lastIncidentAt);
}

function isIncidentRecent(input: MPACInput): IncidentRecency {
  const nowMs = getReferenceTimeMs(input);
  if (input.recentIncidentFlag) {
    return { recent: true, incidentMs: nowMs };
  }

  const incidentMs = parseTimeMs(input.lastIncidentAt);
  if (incidentMs == null) {
    return { recent: false, incidentMs: null };
  }

  return {
    recent: nowMs - incidentMs <= INCIDENT_RECENCY_THRESHOLD_MS,
    incidentMs,
  };
}

function computeNews2(vitals: VitalsSnapshot): NEWS2Breakdown {
  return computeNEWS2({
    rr: vitals.rr,
    spo2: vitals.spo2,
    temp: vitals.tempC ?? vitals.temp,
    sbp: vitals.sbp,
    hr: vitals.hr,
    o2: vitals.o2,
    avpu: vitals.avpu,
    scale2: vitals.scale2,
  });
}

function normalizeRiskLabels(risks: RiskFlags, risksStructured: readonly RiskItem[] = []): string[] {
  const labels = new Set<string>();

  if (risks.fall) labels.add(RISK_LABELS.fall);
  if (risks.pressureUlcer) labels.add(RISK_LABELS.pressureUlcer);
  if (risks.isolation) labels.add(RISK_LABELS.isolation);

  risksStructured
    .filter((risk) => risk.present)
    .forEach((risk) => labels.add(RISK_LABELS[risk.type] ?? risk.type));

  return Array.from(labels);
}

function assessTasks(tasks: readonly PendingTaskSummary[], referenceTimeMs: number): TaskAssessment[] {
  return tasks.map((task) => {
    const dueMs = parseTimeMs(task.dueBy);
    const isOpen = task.status !== 'done';
    const isCritical =
      Boolean(task.critical) || task.priority === 'critical' || task.category === 'escalation';
    const isUrgent = isCritical || Boolean(task.urgent) || task.priority === 'urgent';
    const isOverdue = Boolean(isOpen && dueMs != null && dueMs < referenceTimeMs);
    const isDueSoon = Boolean(
      isOpen && dueMs != null && dueMs >= referenceTimeMs && dueMs - referenceTimeMs <= DUE_SOON_THRESHOLD_MS,
    );

    return {
      id: task.id,
      title: task.title,
      priorityLabel: isCritical ? 'critico' : isUrgent ? 'urgente' : 'rutinario',
      isOpen,
      isCritical,
      isUrgent,
      isOverdue,
      isDueSoon,
      isReevaluation: task.category === 'reevaluation',
    };
  });
}

function createContribution(
  label: string,
  score: number,
  details?: readonly string[],
): MPACDimensionContribution {
  return { label, score, source: 'core', details };
}

function buildDimensionScore(
  key: MPACBaseDimension,
  contributions: readonly MPACDimensionContribution[],
  maxScore = 5,
): MPACDimensionScore {
  return {
    key,
    label: DIMENSION_LABELS[key],
    score: Math.min(maxScore, contributions.reduce((total, contribution) => total + contribution.score, 0)),
    contributions,
  };
}

function computeCoreDimensions(
  input: MPACInput,
  news2: NEWS2Breakdown,
  incident: IncidentRecency,
  taskAssessments: readonly TaskAssessment[],
  riskLabels: readonly string[],
): readonly MPACDimensionScore[] {
  const criticalDevices = input.devices.filter((device) => device.critical);
  const invasiveDevices = input.devices.filter((device) => device.category === 'invasive');
  const supportDevices = input.devices.filter((device) => device.category === 'support');
  const openTasks = taskAssessments.filter((task) => task.isOpen);
  const criticalTasks = openTasks.filter((task) => task.isCritical);
  const urgentTasks = openTasks.filter((task) => task.isUrgent);
  const overdueTasks = openTasks.filter((task) => task.isOverdue);
  const reevaluationTasks = openTasks.filter((task) => task.isReevaluation);
  const alteredConsciousness = input.vitals.avpu != null && input.vitals.avpu !== 'A';

  const instability: MPACDimensionContribution[] = [];
  if (news2.total >= 7) {
    instability.push(createContribution('NEWS2 critico', 5, [`NEWS2 ${news2.total} (${news2.band.toLowerCase()})`]));
  } else if (news2.total >= 5) {
    instability.push(createContribution('NEWS2 alto', 4, [`NEWS2 ${news2.total} (${news2.band.toLowerCase()})`]));
  } else if (news2.total >= 3 || news2.anyThree) {
    instability.push(createContribution('NEWS2 moderado', 2, [`NEWS2 ${news2.total}`]));
  } else if (news2.total >= 1) {
    instability.push(createContribution('NEWS2 leve', 1, [`NEWS2 ${news2.total}`]));
  }
  if (criticalDevices.length > 0) {
    instability.push(createContribution('Soporte critico activo', 1, criticalDevices.map((device) => device.label)));
  }
  if (incident.recent) {
    instability.push(createContribution('Cambio clinico reciente', 1, ['incidente < 18h']));
  }
  if (alteredConsciousness) {
    instability.push(createContribution('AVPU alterado', 1, [`AVPU ${input.vitals.avpu}`]));
  }

  const deterioration: MPACDimensionContribution[] = [];
  if (news2.total >= 5) {
    deterioration.push(createContribution('NEWS2 sugiere deterioro', 2, [`NEWS2 ${news2.total}`]));
  } else if (news2.total >= 3 || news2.anyThree) {
    deterioration.push(createContribution('NEWS2 requiere reevaluacion', 1, [`NEWS2 ${news2.total}`]));
  }
  if (riskLabels.length > 0) {
    deterioration.push(createContribution('Riesgos activos', 1, riskLabels));
  }
  if (incident.recent) {
    deterioration.push(createContribution('Incidente reciente', 1));
  }
  if (criticalDevices.length > 0) {
    deterioration.push(createContribution('Soporte complejo', 1, criticalDevices.map((device) => device.label)));
  }

  const dependency: MPACDimensionContribution[] = [];
  if (criticalDevices.length > 0) {
    dependency.push(createContribution('Soporte critico dominante', 3, criticalDevices.map((device) => device.label)));
  } else if (invasiveDevices.length > 0) {
    dependency.push(createContribution('Dispositivos invasivos activos', 2, invasiveDevices.map((device) => device.label)));
  }
  if (supportDevices.length > 0) {
    dependency.push(createContribution('Soporte adicional', 1, supportDevices.map((device) => device.label)));
  }
  if (input.vitals.o2) {
    dependency.push(createContribution('Oxigenoterapia activa', 1));
  }
  if (alteredConsciousness) {
    dependency.push(createContribution('Vigilancia neurologica', 1, [`AVPU ${input.vitals.avpu}`]));
  }

  const timeCritical: MPACDimensionContribution[] = [];
  if (criticalTasks.length > 0) {
    timeCritical.push(createContribution('Pendientes criticos abiertos', 3, criticalTasks.map((task) => task.title)));
  }
  if (overdueTasks.length > 0) {
    timeCritical.push(createContribution('Pendientes vencidos', 1, overdueTasks.map((task) => task.title)));
  }
  if (urgentTasks.length > 0 && criticalTasks.length === 0) {
    timeCritical.push(createContribution('Pendientes urgentes', 2, urgentTasks.map((task) => task.title)));
  } else if (urgentTasks.length > criticalTasks.length) {
    timeCritical.push(
      createContribution(
        'Pendientes urgentes adicionales',
        1,
        urgentTasks.filter((task) => !task.isCritical).map((task) => task.title),
      ),
    );
  }
  if (openTasks.some((task) => task.isDueSoon)) {
    timeCritical.push(
      createContribution(
        'Vencimiento proximo',
        1,
        openTasks.filter((task) => task.isDueSoon).map((task) => task.title),
      ),
    );
  }
  if (reevaluationTasks.length > 0 || incident.recent) {
    timeCritical.push(
      createContribution('Reevaluacion prioritaria', 1, reevaluationTasks.map((task) => task.title)),
    );
  }

  const therapeuticLoad: MPACDimensionContribution[] = [];
  if (input.devices.length >= 3) {
    therapeuticLoad.push(createContribution('Multiples dispositivos', 2, input.devices.map((device) => device.label)));
  } else if (input.devices.length >= 1) {
    therapeuticLoad.push(createContribution('Dispositivos activos', 1, input.devices.map((device) => device.label)));
  }
  if (criticalDevices.length > 0) {
    therapeuticLoad.push(createContribution('Dispositivo de alta complejidad', 1, criticalDevices.map((device) => device.label)));
  }
  if (openTasks.length >= 3) {
    therapeuticLoad.push(createContribution('Multiples pendientes abiertos', 2, openTasks.map((task) => task.title)));
  } else if (openTasks.length >= 1) {
    therapeuticLoad.push(createContribution('Pendientes abiertos', 1, openTasks.map((task) => task.title)));
  }
  if (input.vitals.o2) {
    therapeuticLoad.push(createContribution('Soporte respiratorio activo', 1));
  }
  if (news2.total >= 5) {
    therapeuticLoad.push(createContribution('Intensidad terapeutica elevada', 1, [`NEWS2 ${news2.total}`]));
  }

  return [
    buildDimensionScore('instability', instability),
    buildDimensionScore('deterioration-risk', deterioration),
    buildDimensionScore('dependency', dependency),
    buildDimensionScore('time-critical', timeCritical),
    buildDimensionScore('therapeutic-load', therapeuticLoad),
  ];
}

function getDimensionMap(
  dimensions: readonly MPACDimensionScore[],
): Record<MPACBaseDimension, MPACDimensionScore> {
  return dimensions.reduce(
    (map, dimension) => {
      map[dimension.key] = dimension;
      return map;
    },
    {} as Record<MPACBaseDimension, MPACDimensionScore>,
  );
}

function getContextSupportScore(
  signal: ContextualPrioritySignal,
  dimensionMap: Record<MPACBaseDimension, MPACDimensionScore>,
  taskAssessments: readonly TaskAssessment[],
  riskLabels: readonly string[],
  profileContext: ProfileContext,
): number {
  const openTasks = taskAssessments.filter((task) => task.isOpen);
  const criticalTasks = openTasks.filter((task) => task.isCritical);

  switch (signal.dimension) {
    case 'instability':
      return dimensionMap.instability.score;
    case 'deterioration-risk':
      return dimensionMap['deterioration-risk'].score;
    case 'dependency':
      return dimensionMap.dependency.score;
    case 'time-critical':
      return dimensionMap['time-critical'].score;
    case 'therapeutic-load':
      return dimensionMap['therapeutic-load'].score;
    case 'omission-risk':
      return Math.max(riskLabels.length > 0 ? 1 : 0, openTasks.length > 0 ? 1 : 0);
    case 'coordination':
      return Math.max(openTasks.length > 1 ? 2 : openTasks.length, profileContext.hasHumanSpecialtyOverride ? 1 : 0);
    case 'unit-modifier':
      return Math.max(dimensionMap.dependency.score, dimensionMap['therapeutic-load'].score);
    case 'specialty-modifier':
      return Math.max(
        dimensionMap.instability.score,
        dimensionMap['deterioration-risk'].score,
        dimensionMap['time-critical'].score,
        criticalTasks.length > 0 ? 1 : 0,
      );
    default:
      return 0;
  }
}

function buildModifierNote(
  signal: ContextualPrioritySignal & { source: 'unit-profile' | 'specialty-overlay' },
  applied: boolean,
): string {
  if (!applied) {
    return `Contexto activo sin cambio cuantitativo para ${signal.dimension}`;
  }

  if (signal.explanation) {
    return `${signal.source === 'unit-profile' ? 'UPP' : 'SOP'}: ${signal.explanation}`;
  }

  return `Modificador ${signal.source === 'unit-profile' ? 'UPP' : 'SOP'} aplicado sobre ${signal.dimension}`;
}

function computeContextModifiers(
  profileContext: ProfileContext,
  dimensions: readonly MPACDimensionScore[],
  taskAssessments: readonly TaskAssessment[],
  riskLabels: readonly string[],
): MPACContextModifier[] {
  const dimensionMap = getDimensionMap(dimensions);

  return profileContext.prioritySignals
    .filter(
      (signal): signal is ContextualPrioritySignal & { source: 'unit-profile' | 'specialty-overlay' } =>
        signal.source === 'unit-profile' || signal.source === 'specialty-overlay',
    )
    .map((signal) => {
      const supportScore = getContextSupportScore(signal, dimensionMap, taskAssessments, riskLabels, profileContext);
      const weight = signal.weight ?? 1;
      const contribution = roundToOneDecimal(
        Math.min(1.5, supportScore * PROFILE_SIGNAL_MULTIPLIER[signal.source] * weight),
      );
      const applied = contribution > 0;

      return {
        signalId: signal.id,
        label: signal.label,
        dimension: signal.dimension,
        source: signal.source,
        profileId: signal.profileId,
        weight,
        contribution,
        applied,
        note: buildModifierNote(signal, applied),

      };
    });
}

function deriveLevel(
  totalScore: number,
  dimensions: readonly MPACDimensionScore[],
  news2: NEWS2Breakdown,
  devices: readonly DeviceSummary[],
  override?: MPACPriorityOverride,
): MPACPriorityLevel {
  if (override) return override.level;

  const dimensionMap = getDimensionMap(dimensions);
  const criticalDeviceCount = devices.filter((device) => device.critical).length;

  if (
    news2.total >= 7 ||
    (criticalDeviceCount > 0 && dimensionMap.dependency.score >= 4 && dimensionMap['time-critical'].score >= 3) ||
    totalScore >= LEVEL_SCORE_FLOORS.critical
  ) {
    return 'critical';
  }
  if (totalScore >= LEVEL_SCORE_FLOORS.high) return 'high';
  if (totalScore >= LEVEL_SCORE_FLOORS.medium) return 'medium';
  return 'low';
}

function deriveReasonCodes(
  input: MPACInput,
  news2: NEWS2Breakdown,
  incident: IncidentRecency,
  taskAssessments: readonly TaskAssessment[],
  riskLabels: readonly string[],
  modifiers: readonly MPACContextModifier[],
  dimensions: readonly MPACDimensionScore[],
): MPACReasonCode[] {
  const reasons: MPACReasonCode[] = [];

  if (news2.total >= 5) reasons.push('HIGH_NEWS2');
  if (input.devices.some((device) => device.category === 'invasive' || device.critical)) reasons.push('INVASIVE_DEVICE');
  if (taskAssessments.some((task) => task.isOpen && (task.isCritical || task.isUrgent))) reasons.push('PENDING_URGENT_TASK');
  if (riskLabels.length > 0) reasons.push('HIGH_RISK_FLAGS');
  if (incident.recent) reasons.push('RECENT_INCIDENT');
  if (getDimensionMap(dimensions).dependency.score >= 4) reasons.push('DEPENDENCY_SURVEILLANCE');
  if (modifiers.some((modifier) => modifier.applied)) reasons.push('PROFILE_CONTEXT');
  if (input.manualOverride) reasons.push('MANUAL_OVERRIDE');

  return reasons;
}

function buildSourceData(
  input: MPACInput,
  news2: NEWS2Breakdown,
  riskLabels: readonly string[],
  taskAssessments: readonly TaskAssessment[],
): string[] {
  const sourceData = [`NEWS2 ${news2.total} (${news2.band.toLowerCase()})`];
  const openTasks = taskAssessments.filter((task) => task.isOpen);

  if (input.devices.length > 0) {
    sourceData.push(
      `${input.devices.length} dispositivo${input.devices.length > 1 ? 's' : ''} activo${input.devices.length > 1 ? 's' : ''}`,
    );
  }
  if (riskLabels.length > 0) {
    sourceData.push(`Riesgos: ${riskLabels.join(', ')}`);
  }
  if (openTasks.length > 0) {
    sourceData.push(`${openTasks.length} pendiente${openTasks.length > 1 ? 's' : ''} abierto${openTasks.length > 1 ? 's' : ''}`);
  }
  if (input.vitals.avpu && input.vitals.avpu !== 'A') {
    sourceData.push(`AVPU ${input.vitals.avpu}`);
  }

  return sourceData;
}

function buildClinicalChange(
  input: MPACInput,
  news2: NEWS2Breakdown,
  incident: IncidentRecency,
): string[] {
  const clinicalChange: string[] = [];

  if (incident.recent) clinicalChange.push('Incidente reciente registrado');
  if (input.vitals.avpu && input.vitals.avpu !== 'A') {
    clinicalChange.push(`Cambio neurologico: AVPU ${input.vitals.avpu}`);
  }
  if (news2.anyThree) clinicalChange.push('NEWS2 con red flag');
  if (news2.total >= 5) clinicalChange.push(`NEWS2 alto (${news2.total})`);

  return clinicalChange;
}

function buildPendingCritical(taskAssessments: readonly TaskAssessment[]): string[] {
  return taskAssessments
    .filter((task) => task.isOpen && (task.isCritical || task.isUrgent || task.isOverdue))
    .map((task) => `${task.title} (${task.priorityLabel}${task.isOverdue ? ', vencido' : ''})`);
}

function formatContextForSummary(labels: readonly string[]): string | null {
  const contextualLabels = labels.filter((label) => label !== 'HANDOVER Core');
  return contextualLabels.length > 0 ? `contexto ${contextualLabels.join(' + ')}` : null;
}

function buildReasonSummary(
  news2: NEWS2Breakdown,
  input: MPACInput,
  riskLabels: readonly string[],
  incident: IncidentRecency,
  taskAssessments: readonly TaskAssessment[],
  activeContextLabels: readonly string[],
): string {
  const parts: string[] = [`NEWS2 ${news2.total}`];
  const priorityTasks = taskAssessments.filter((task) => task.isOpen && (task.isCritical || task.isUrgent));
  const criticalDevices = input.devices.filter((device) => device.critical);

  if (criticalDevices.length > 0) {
    parts.push(criticalDevices.map((device) => device.label).join(', '));
  } else {
    const invasive = input.devices.find((device) => device.category === 'invasive');
    if (invasive) parts.push(invasive.label);
  }
  if (incident.recent) parts.push('incidente reciente');
  if (priorityTasks.length > 0) {
    parts.push(
      `${priorityTasks.length} pendiente${priorityTasks.length > 1 ? 's' : ''} critico${priorityTasks.length > 1 ? 's' : ''}`,
    );
  }
  if (riskLabels.length > 0) {
    parts.push(`riesgos activos (${riskLabels.join('/')})`);
  }

  const contextSummary = formatContextForSummary(activeContextLabels);
  if (contextSummary) parts.push(contextSummary);
  if (input.manualOverride) parts.push(`override manual a ${input.manualOverride.level.toUpperCase()}`);

  return parts.join(', ');
}

function applyOverrideScoreFloor(totalScore: number, override?: MPACPriorityOverride): number {
  return override ? Math.max(totalScore, LEVEL_SCORE_FLOORS[override.level]) : totalScore;
}

export function resolveMPACInput(input: MPACInput): MPACResolvedInput {
  const profileContext = input.profileContext ?? resolveProfileContext({ unitId: input.unitId, specialtyId: input.specialtyId });
  const contextLabels = input.activeContextLabels ?? [
    'HANDOVER Core',
    ...(profileContext.unitProfileId
      ? [getUnitProfileDefinition(profileContext.unitProfileId)?.label ?? profileContext.unitProfileId]
      : []),
    ...profileContext.specialtyOverlayIds.map(
      (overlayId) => getSpecialtyOverlayDefinition(overlayId)?.label ?? overlayId,
    ),
  ];

  return {
    ...input,
    profileContext,
    activeContextLabels: unique(contextLabels),
  };
}

export function computeMPAC(
  input: MPACResolvedInput,
  options?: { futureExtension?: MPACFutureExtension | null },
): MPACResult {
  const news2 = computeNews2(input.vitals);
  const incident = isIncidentRecent(input);
  const taskAssessments = assessTasks(input.pendingTasks, getReferenceTimeMs(input));
  const riskLabels = normalizeRiskLabels(input.risks, input.risksStructured);
  const coreDimensions = computeCoreDimensions(input, news2, incident, taskAssessments, riskLabels);
  const baseScore = coreDimensions.reduce((total, dimension) => total + dimension.score, 0);
  const modifiers = computeContextModifiers(input.profileContext, coreDimensions, taskAssessments, riskLabels);
  const modifierScore = modifiers
    .filter((modifier) => modifier.applied)
    .reduce((total, modifier) => total + modifier.contribution, 0);
  const preliminaryTotal = roundToOneDecimal(baseScore + modifierScore);
  const totalScore = applyOverrideScoreFloor(preliminaryTotal, input.manualOverride);
  const baseLevel = deriveLevel(preliminaryTotal, coreDimensions, news2, input.devices);
  const level = deriveLevel(totalScore, coreDimensions, news2, input.devices, input.manualOverride);
  const pendingCritical = buildPendingCritical(taskAssessments);
  const reasons = deriveReasonCodes(input, news2, incident, taskAssessments, riskLabels, modifiers, coreDimensions);
  const reasonSummary = buildReasonSummary(
    news2,
    input,
    riskLabels,
    incident,
    taskAssessments,
    input.activeContextLabels,
  );

  let result: MPACResult = {
    patientId: input.patientId,
    displayName: input.displayName,
    bedLabel: input.bedLabel,
    news2Score: news2.total,
    totalScore,
    baseScore,
    level,
    baseLevel,
    reasons,
    reasonSummary,
    pendingCriticalTasksCount: pendingCritical.length,
    explanation: {
      engine: 'mpac-v1-hybrid-rules',
      version: 1,
      sourceData: buildSourceData(input, news2, riskLabels, taskAssessments),
      clinicalChange: buildClinicalChange(input, news2, incident),
      pendingCritical,
      activeContext: {
        unitId: input.profileContext.unitId,
        specialtyId: input.profileContext.specialtyId,
        unitProfileId: input.profileContext.unitProfileId,
        specialtyOverlayIds: input.profileContext.specialtyOverlayIds,
        activeProfileIds: input.profileContext.activeProfileIds,
        labels: input.activeContextLabels,
        usesCoreFallback: input.profileContext.usesCoreFallback,
        hasHumanSpecialtyOverride: input.profileContext.hasHumanSpecialtyOverride,
      },
      coreDimensions,
      modifiers,
      override: input.manualOverride,
    },
    manualOverride: input.manualOverride,
  };

  const futureExtension = options?.futureExtension?.augment(input, result) ?? null;
  if (futureExtension) {
    const extendedScore = roundToOneDecimal(result.totalScore + futureExtension.scoreDelta);
    result = {
      ...result,
      totalScore: extendedScore,
      level: deriveLevel(extendedScore, coreDimensions, news2, input.devices, input.manualOverride),
      explanation: {
        ...result.explanation,
        futureExtension,
      },
    };
  }

  return result;
}

export function computeMPACFromInput(
  input: MPACInput,
  options?: { futureExtension?: MPACFutureExtension | null },
): MPACResult {
  return computeMPAC(resolveMPACInput(input), options);
}

export default {
  computeMPAC,
  computeMPACFromInput,
  resolveMPACInput,
};



