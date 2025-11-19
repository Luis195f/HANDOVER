// Fase 3 – Bloque C (prioridad): cálculo de prioridad clínica por paciente.
import { computeNEWS2 } from './news2';
import type {
  DeviceSummary,
  PendingTaskSummary,
  RiskFlags,
  VitalsSnapshot,
} from '@/src/types/handover';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export type PriorityReasonCode =
  | 'HIGH_NEWS2'
  | 'INVASIVE_DEVICE'
  | 'RECENT_INCIDENT'
  | 'PENDING_URGENT_TASK'
  | 'HIGH_RISK_FLAGS';

export interface PrioritizedPatient {
  patientId: string;
  displayName: string;
  bedLabel?: string;
  news2Score: number;
  level: PriorityLevel;
  reasons: PriorityReasonCode[];
  reasonSummary: string;
}

type PrioritizedPatientInternal = PrioritizedPatient & { incidentMs: number | null };

export interface PriorityInput {
  patientId: string;
  displayName: string;
  bedLabel?: string;
  vitals: VitalsSnapshot;
  devices: DeviceSummary[];
  risks: RiskFlags;
  pendingTasks: PendingTaskSummary[];
  lastIncidentAt?: string | null;
  recentIncidentFlag?: boolean;
  referenceTime?: string | number | Date;
}

const INCIDENT_RECENCY_THRESHOLD_MS = 18 * 60 * 60 * 1000; // Incidente <18h se considera reciente.
const levelWeights: Record<PriorityLevel, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

function getReferenceTimeMs(input: PriorityInput): number {
  if (input.referenceTime) {
    const ref = new Date(input.referenceTime).getTime();
    if (!Number.isNaN(ref)) return ref;
  }
  return Date.now();
}

function isIncidentRecent(input: PriorityInput): { recent: boolean; incidentMs: number | null } {
  const nowMs = getReferenceTimeMs(input);
  if (input.recentIncidentFlag) {
    return { recent: true, incidentMs: nowMs };
  }
  if (!input.lastIncidentAt) return { recent: false, incidentMs: null };
  const incidentMs = new Date(input.lastIncidentAt).getTime();
  if (Number.isNaN(incidentMs)) return { recent: false, incidentMs: null };
  const recent = nowMs - incidentMs <= INCIDENT_RECENCY_THRESHOLD_MS;
  return { recent, incidentMs };
}

function hasInvasiveDevice(devices: DeviceSummary[]): { has: boolean; label?: string } {
  const device = devices.find(d => d.category === 'invasive' || d.critical);
  return { has: Boolean(device), label: device?.label };
}

function countUrgentTasks(tasks: PendingTaskSummary[]): number {
  return tasks.filter(task => task.urgent || task.critical).length;
}

function hasHighRiskFlags(risks: RiskFlags): boolean {
  return Boolean(risks.fall || risks.pressureUlcer || risks.isolation);
}

function evaluatePriority(input: PriorityInput): PrioritizedPatientInternal {
  const news2 = computeNEWS2({
    rr: input.vitals.rr,
    spo2: input.vitals.spo2,
    temp: input.vitals.tempC ?? input.vitals.temp,
    sbp: input.vitals.sbp,
    hr: input.vitals.hr,
    o2: input.vitals.o2,
    avpu: input.vitals.avpu,
    scale2: input.vitals.scale2,
  }).total;

  const reasons: PriorityReasonCode[] = [];
  const { has: deviceIsInvasive, label: invasiveDeviceLabel } = hasInvasiveDevice(input.devices);
  if (news2 >= 5) {
    reasons.push('HIGH_NEWS2'); // NEWS2 >=5 indica deterioro clínico moderado-alto.
  }
  if (deviceIsInvasive) {
    reasons.push('INVASIVE_DEVICE'); // VM, CVC u otro soporte invasivo.
  }
  const urgentTasks = countUrgentTasks(input.pendingTasks);
  if (urgentTasks > 0) {
    reasons.push('PENDING_URGENT_TASK');
  }
  const highRiskFlags = hasHighRiskFlags(input.risks);
  if (highRiskFlags) {
    reasons.push('HIGH_RISK_FLAGS');
  }
  const { recent: recentIncident, incidentMs } = isIncidentRecent(input);
  if (recentIncident) {
    reasons.push('RECENT_INCIDENT');
  }

  let level: PriorityLevel = 'low';
  if (news2 >= 7 || deviceIsInvasive || recentIncident) {
    level = 'critical'; // NEWS2 >=7 o soporte invasivo → crítico inmediato.
  } else if (news2 >= 5) {
    level = 'high'; // NEWS2 5–6: alto riesgo.
  } else if (news2 >= 3 && (urgentTasks > 0 || highRiskFlags || deviceIsInvasive)) {
    level = 'high'; // NEWS2 moderado con otro factor agrava la prioridad.
  } else if (news2 >= 3 || urgentTasks > 0 || highRiskFlags) {
    level = 'medium';
  }

  const parts: string[] = [`NEWS2 ${news2}`];
  if (deviceIsInvasive) {
    parts.push(invasiveDeviceLabel ? invasiveDeviceLabel : 'dispositivo invasivo');
  }
  if (recentIncident) {
    parts.push('incidente reciente');
  }
  if (urgentTasks > 0) {
    parts.push(`${urgentTasks} tarea${urgentTasks > 1 ? 's' : ''} crítica${urgentTasks > 1 ? 's' : ''}`);
  }
  if (highRiskFlags) {
    parts.push('riesgo elevado (caídas/UPP/aislamiento)');
  }

  const reasonSummary = parts.join(', ');

  return {
    patientId: input.patientId,
    displayName: input.displayName,
    bedLabel: input.bedLabel,
    news2Score: news2,
    level,
    reasons,
    reasonSummary,
    incidentMs,
  };
}

export function computePriority(input: PriorityInput): PrioritizedPatient {
  const { incidentMs: _incidentMs, ...patient } = evaluatePriority(input);
  return patient;
}

export function computePriorityList(inputs: PriorityInput[]): PrioritizedPatient[] {
  const prioritized = inputs.map(input => {
    const patient = evaluatePriority(input);
    return {
      patient,
      meta: {
        levelWeight: levelWeights[patient.level],
        incidentMs: patient.incidentMs,
        lastIncidentAt: input.lastIncidentAt ?? null,
      },
    };
  });

  prioritized.sort((a, b) => {
    if (b.meta.levelWeight !== a.meta.levelWeight) return b.meta.levelWeight - a.meta.levelWeight;
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
