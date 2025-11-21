import { v4 as uuidv4 } from 'uuid';

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
