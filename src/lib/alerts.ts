import { v4 as uuidv4 } from 'uuid';

import { FALL_BASIC_ACTIONS, PRESSURE_ULCER_PREVENTION_ACTIONS } from '../config/risks';
import type { Handover, RiskItem, RiskType } from '../types/handover';
import { computeNEWS2 } from './news2';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertKind =
  | 'NEWS2_HIGH'
  | 'NEWS2_MODERATE'
  | 'DEVICE_OLD'
  | 'TASK_OVERDUE'
  | 'ALLERGY_CONFLICT';

export interface Alert {
  id: string; // UUID
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
}

export interface AlertsInput {
  news2Score?: number | null;

  devices?: Array<{
    code: string;
    insertedAt?: string;
  }>;

  tasks?: Array<{
    id: string;
    dueAt?: string;
    completed?: boolean;
    critical?: boolean;
  }>;

  allergies?: Array<{
    code: string;
  }>;

  medications?: Array<{
    code: string;
  }>;

  now?: Date;
}

function createId(): string {
  return uuidv4();
}

function isDateValid(value?: string): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp);
}

function isOlderThanDays(dateIso: string, now: Date, days: number): boolean {
  const targetTime = new Date(dateIso).getTime();
  const diffMs = now.getTime() - targetTime;
  return diffMs > days * 24 * 60 * 60 * 1000;
}

export function alertsFromData(values: AlertsInput): Alert[] {
  const now = values.now ?? new Date();
  const alerts: Alert[] = [];
  const addedKinds = new Set<AlertKind>();

  const addAlert = (kind: AlertKind, severity: AlertSeverity, message: string) => {
    if (addedKinds.has(kind)) return;
    alerts.push({ id: createId(), kind, severity, message });
    addedKinds.add(kind);
  };

  const score = typeof values.news2Score === 'number' ? values.news2Score : null;
  if (score !== null) {
    if (score >= 7) {
      addAlert('NEWS2_HIGH', 'critical', 'NEWS2 ≥ 7, vigilar');
    } else if (score >= 5) {
      addAlert('NEWS2_MODERATE', 'warning', 'NEWS2 entre 5 y 6');
    }
  }

  if (Array.isArray(values.devices)) {
    const hasOldDevice = values.devices.some((device) =>
      isDateValid(device.insertedAt) ? isOlderThanDays(device.insertedAt as string, now, 7) : false,
    );
    if (hasOldDevice) {
      addAlert('DEVICE_OLD', 'warning', 'Revisar dispositivo invasivo con más de 7 días');
    }
  }

  if (Array.isArray(values.tasks)) {
    let overdue = false;
    let hasCritical = false;

    values.tasks.forEach((task) => {
      if (!isDateValid(task.dueAt)) return;
      const dueAtTime = new Date(task.dueAt as string).getTime();
      if (task.completed) return;
      if (dueAtTime < now.getTime()) {
        overdue = true;
        if (task.critical) {
          hasCritical = true;
        }
      }
    });

    if (overdue) {
      addAlert('TASK_OVERDUE', hasCritical ? 'critical' : 'warning', 'Tareas pendientes vencidas');
    }
  }

  if (Array.isArray(values.allergies) && Array.isArray(values.medications)) {
    const allergyCodes = new Set(values.allergies.map((item) => item.code));
    const hasConflict = values.medications.some((med) => allergyCodes.has(med.code));
    if (hasConflict) {
      addAlert('ALLERGY_CONFLICT', 'critical', 'Conflicto alergia vs medicación');
    }
  }

  return alerts;
}

export interface AlertsSummary {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export function summarizeAlerts(alerts: Alert[]): AlertsSummary {
  return alerts.reduce(
    (acc, alert) => {
      if (alert.severity === 'critical') acc.criticalCount += 1;
      else if (alert.severity === 'warning') acc.warningCount += 1;
      else acc.infoCount += 1;
      return acc;
    },
    { criticalCount: 0, warningCount: 0, infoCount: 0 },
  );
}

export interface HandoverAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  source: 'risk' | 'vitals' | 'checklist' | 'system';
  riskType?: RiskType;
}

function deriveRisksFromLegacy(risks?: Handover['risks']): RiskItem[] {
  if (!risks) return [];
  const items: RiskItem[] = [];
  if (risks.fall) items.push({ type: 'fall', present: true, actions: [], notes: undefined });
  if (risks.pressureUlcer)
    items.push({ type: 'pressureUlcer', present: true, actions: [], notes: undefined });
  if (risks.isolation) items.push({ type: 'isolation', present: true, actions: [], notes: undefined });
  return items;
}

function safeNews2Score(handover: Handover): number | undefined {
  const vitals = handover.vitals;
  if (!vitals) return undefined;
  const hasVitals = ['rr', 'spo2', 'tempC', 'sbp', 'hr'].some(
    key => typeof (vitals as Record<string, unknown>)[key] === 'number',
  );
  if (!hasVitals) return undefined;
  const breakdown = computeNEWS2({
    rr: vitals.rr,
    spo2: vitals.spo2,
    temp: (vitals as any).temp ?? vitals.tempC,
    sbp: vitals.sbp,
    hr: vitals.hr,
    o2: (vitals as any).o2,
    avpu: vitals.avpu as any,
    scale2: (vitals as any).scale2,
  });
  return breakdown.total;
}

function normalizeRisks(handover: Handover): RiskItem[] {
  if (Array.isArray(handover.risksStructured) && handover.risksStructured.length > 0) {
    return handover.risksStructured;
  }
  return deriveRisksFromLegacy(handover.risks);
}

function hasAnyAction(risk: RiskItem | undefined, allowed: readonly string[]): boolean {
  if (!risk) return false;
  return (risk.actions ?? []).some(action => allowed.includes(action));
}

export function computeAlerts(handover: Handover): HandoverAlert[] {
  const alerts: HandoverAlert[] = [];

  const risks = normalizeRisks(handover);
  const news2 = safeNews2Score(handover);
  const bradenScore =
    typeof handover.braden?.totalScore === 'number'
      ? handover.braden.totalScore
      : typeof (handover as any)?.clinicalScales?.braden?.score === 'number'
        ? (handover as any).clinicalScales.braden.score
        : undefined;

  const fallRisk = risks.find(risk => risk.type === 'fall' && risk.present);
  if (fallRisk && !hasAnyAction(fallRisk, FALL_BASIC_ACTIONS)) {
    alerts.push({
      id: 'risk-fall-no-actions',
      severity: 'warning',
      source: 'risk',
      riskType: 'fall',
      message:
        'Riesgo de caídas marcado sin medidas preventivas básicas (barandillas, cama baja, timbre accesible).',
    });
  }

  const pressureRisk = risks.find(risk => risk.type === 'pressureUlcer' && risk.present);
  const isBradenHighRisk = typeof bradenScore === 'number' && bradenScore <= 12;
  if (pressureRisk && isBradenHighRisk && !hasAnyAction(pressureRisk, PRESSURE_ULCER_PREVENTION_ACTIONS)) {
    alerts.push({
      id: 'risk-pressure-no-actions',
      severity: 'warning',
      source: 'risk',
      riskType: 'pressureUlcer',
      message: 'Riesgo de úlceras por presión elevado sin medidas preventivas suficientes.',
    });
  }

  const anyRiskPresent = risks.some(risk => risk.present);
  const isHighNews2 = typeof news2 === 'number' && news2 >= 7;
  if (isHighNews2 && anyRiskPresent) {
    alerts.push({
      id: 'news2-high-with-risk',
      severity: 'critical',
      source: 'vitals',
      message:
        'NEWS2 elevado junto con riesgos activos. Revisar al paciente de forma prioritaria.',
    });
  }

  return alerts;
}
