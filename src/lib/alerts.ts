import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { FALL_BASIC_ACTIONS, PRESSURE_ULCER_PREVENTION_ACTIONS } from '../config/risks';
import type { RiskItem, RiskType } from '../types/handover';
import type { HandoverFormData } from '../validation/schemas';
import { computeNEWS2 } from './news2';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertKind =
  | 'NEWS2_HIGH'
  | 'NEWS2_MODERATE'
  | 'DEVICE_OLD'
  | 'TASK_OVERDUE'
  | 'ALLERGY_CONFLICT';

export interface Alert {
  id: string;
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

  allergies?: Array<{ code: string }>;
  medications?: Array<{ code: string }>;
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
    if (score >= 7) addAlert('NEWS2_HIGH', 'critical', 'NEWS2 ≥ 7, vigilar');
    else if (score >= 5) addAlert('NEWS2_MODERATE', 'warning', 'NEWS2 entre 5 y 6');
  }

  if (Array.isArray(values.devices)) {
    const hasOldDevice = values.devices.some((device) =>
      isDateValid(device.insertedAt) ? isOlderThanDays(device.insertedAt as string, now, 7) : false,
    );
    if (hasOldDevice) addAlert('DEVICE_OLD', 'warning', 'Revisar dispositivo invasivo con más de 7 días');
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
        if (task.critical) hasCritical = true;
      }
    });

    if (overdue) addAlert('TASK_OVERDUE', hasCritical ? 'critical' : 'warning', 'Tareas pendientes vencidas');
  }

  if (Array.isArray(values.allergies) && Array.isArray(values.medications)) {
    const allergyCodes = new Set(values.allergies.map((item) => item.code));
    const hasConflict = values.medications.some((med) => allergyCodes.has(med.code));
    if (hasConflict) addAlert('ALLERGY_CONFLICT', 'critical', 'Conflicto alergia vs medicación');
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

// ✅ Entrada flexible: el form actual (HandoverFormData) + opcional clinicalScales legacy
export type HandoverAlertsSource = {
  vitals?: unknown;
  risks?: Handover['risks'];
  risksStructured?: RiskItem[];
  braden?: unknown;
  clinicalScales?: unknown;
};

const vitalsSchema = z
  .object({
    rr: z.number().optional(),
    spo2: z.number().optional(),
    tempC: z.number().optional(),
    temp: z.number().optional(),
    sbp: z.number().optional(),
    hr: z.number().optional(),
    o2: z.boolean().optional(),
    avpu: z.enum(['A', 'C', 'V', 'P', 'U']).optional(),
    scale2: z.boolean().optional(),
  })
  .passthrough();

function deriveRisksFromLegacy(risks?: HandoverFormData['risks']): RiskItem[] {
  if (!risks) return [];
  const items: RiskItem[] = [];
  if ((risks as any).fall) items.push({ type: 'fall', present: true, actions: [], notes: undefined });
  if ((risks as any).pressureUlcer) items.push({ type: 'pressureUlcer', present: true, actions: [], notes: undefined });
  if ((risks as any).isolation) items.push({ type: 'isolation', present: true, actions: [], notes: undefined });
  return items;
}

function safeNews2ScoreFromVitals(vitalsValue: unknown): number | undefined {
  const parsed = vitalsSchema.safeParse(vitalsValue);
  if (!parsed.success) return undefined;
  const vitals = parsed.data;
  
  const hasVitals = [vitals.rr, vitals.spo2, vitals.tempC, vitals.temp, vitals.sbp, vitals.hr].some(
    (value) => typeof value === 'number',
  );
  if (!hasVitals) return undefined;

  const breakdown = computeNEWS2({
    rr: vitals.rr,
    spo2: vitals.spo2,
    temp: vitals.temp ?? vitals.tempC,
    sbp: vitals.sbp,
    hr: vitals.hr,
    o2: vitals.o2,
    avpu: vitals.avpu,
    scale2: vitals.scale2,
  });

  return breakdown.total;
}

function normalizeRisks(handover: HandoverAlertsSource): RiskItem[] {
  if (Array.isArray((handover as any).risksStructured) && (handover as any).risksStructured.length > 0) {
    return (handover as any).risksStructured as RiskItem[];
  }
  return deriveRisksFromLegacy(handover.risks);
}

function hasAnyAction(risk: RiskItem | undefined, allowed: readonly string[]): boolean {
  if (!risk) return false;
  return (risk.actions ?? []).some((action) => allowed.includes(action));
}

export function computeAlerts(source: HandoverAlertsSource): HandoverAlert[] {
  const alerts: HandoverAlert[] = [];

  const risks =
    Array.isArray(source.risksStructured) && source.risksStructured.length > 0
      ? source.risksStructured
      : deriveRisksFromLegacy(source.risks);

  const news2 = safeNews2ScoreFromVitals(source.vitals);

  const bradenScore = (() => {
    const bradenAny = source.braden as any;
    if (typeof bradenAny?.totalScore === 'number') return bradenAny.totalScore;

    const cs = source.clinicalScales as any;
    const score = cs?.braden?.score;
    return typeof score === 'number' ? score : undefined;
  })();

  const fallRisk = risks.find((risk) => risk.type === 'fall' && risk.present);
  if (fallRisk && !hasAnyAction(fallRisk, FALL_BASIC_ACTIONS)) {
    alerts.push({
      id: 'risk-fall-no-actions',
      severity: 'warning',
      source: 'risk',
      riskType: 'fall',
      message: 'Riesgo de caídas marcado sin medidas preventivas básicas (barandillas, cama baja, timbre accesible).',
    });
  }

  const pressureRisk = risks.find((risk) => risk.type === 'pressureUlcer' && risk.present);
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

  const anyRiskPresent = risks.some((risk) => risk.present);
  const isHighNews2 = typeof news2 === 'number' && news2 >= 7;
  if (isHighNews2 && anyRiskPresent) {
    alerts.push({
      id: 'news2-high-with-risk',
      severity: 'critical',
      source: 'vitals',
      message: 'NEWS2 elevado junto con riesgos activos. Revisar al paciente de forma prioritaria.',
    });
  }

  return alerts;
}
