import { ALERT_CODES } from "./codes";
import { computeNEWS2, NEWS2Breakdown, NEWS2Input } from "./news2";

export type AlertSeverity = "low" | "moderate" | "high" | "critical";

export type Alert = {
  id: string;
  code: string;
  severity: AlertSeverity;
  message: string;
  data?: unknown;
};

export type ClinicalAllergy = {
  id: string;
  substance: string;
  code?: string;
};

export type ClinicalMedication = {
  id: string;
  name: string;
  code?: string;
  ingredients?: string[];
  critical?: boolean;
  startedAt?: string;
};

export type ClinicalLine = {
  id: string;
  kind: "catheter" | "other";
  insertedAt?: string;
  label?: string;
};

export type ClinicalWoundCare = {
  id: string;
  kind: "dressing" | "drain";
  dueAt: string;
  description?: string;
};

export type ClinicalOxygenTherapy = {
  active: boolean;
  start: string;
  fio2?: number;
  flowLpm?: number;
  device?: string;
};

export type ClinicalGlucoseReading = {
  value: number;
  unit: "mg/dL" | "mmol/L";
  takenAt: string;
};

export type ClinicalInput = {
  patient?: {
    id: string;
    name: string;
    diagnosis?: string;
    location?: string;
  };
  vitals?: NEWS2Input & { recordedAt?: string };
  lines?: ClinicalLine[];
  allergies?: ClinicalAllergy[];
  medications?: ClinicalMedication[];
  woundCare?: ClinicalWoundCare[];
  oxygenTherapy?: ClinicalOxygenTherapy | null;
  glucoseReadings?: ClinicalGlucoseReading[];
  medsCritical?: string[];
  lastUpdated?: string;
};

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;
const CATHETER_THRESHOLD_DAYS = 7;
const OXYGEN_PROLONGED_HOURS = 24;
const OXYGEN_ESCALATE_HOURS = 96;
const HIGH_FIO2_THRESHOLD = 0.6;

const NEWS2_BAND_SEVERITY: Record<NEWS2Breakdown["band"], AlertSeverity> = {
  BAJA: "low",
  MEDIA: "moderate",
  ALTA: "high",
  CRÍTICA: "critical",
};

function toDate(value?: string) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / MILLISECONDS_IN_DAY;
}

function hoursBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / MILLISECONDS_IN_HOUR;
}

function normalise(value?: string) {
  return value?.trim().toLowerCase();
}

function hasAllergyConflict(
  medication: ClinicalMedication,
  allergies: ClinicalAllergy[] | undefined,
): ClinicalAllergy | undefined {
  if (!allergies?.length) return undefined;
  const identifiers = new Set(
    [medication.code, ...(medication.ingredients ?? [])]
      .map(normalise)
      .filter((v): v is string => Boolean(v)),
  );
  if (!identifiers.size) return undefined;
  return allergies.find(allergy => {
    const allergyIds = [allergy.code, allergy.substance]
      .map(normalise)
      .filter((v): v is string => Boolean(v));
    return allergyIds.some(id => identifiers.has(id));
  });
}

function buildNews2Alert(breakdown: NEWS2Breakdown): Alert {
  const severity = NEWS2_BAND_SEVERITY[breakdown.band];
  const message = `NEWS2 ${breakdown.total} (${breakdown.band})`;
  return {
    id: `${ALERT_CODES.news2}:${breakdown.total}`,
    code: ALERT_CODES.news2,
    severity,
    message,
    data: breakdown,
  };
}

function catheterAlerts(
  lines: ClinicalLine[] | undefined,
  now: Date,
): Alert[] {
  if (!lines?.length) return [];
  const alerts: Alert[] = [];
  for (const line of lines) {
    if (line.kind !== "catheter") continue;
    const inserted = toDate(line.insertedAt);
    if (!inserted) continue;
    const ageDays = daysBetween(inserted, now);
    if (ageDays <= CATHETER_THRESHOLD_DAYS) continue;
    const rounded = Math.floor(ageDays);
    const label = line.label ?? line.id;
    alerts.push({
      id: `${ALERT_CODES.catheterOverdue}:${line.id}`,
      code: ALERT_CODES.catheterOverdue,
      severity: "high",
      message: `Catéter ${label} con ${rounded} días desde inserción`,
      data: { line, ageDays },
    });
  }
  return alerts;
}

function woundCareAlerts(
  entries: ClinicalWoundCare[] | undefined,
  now: Date,
): Alert[] {
  if (!entries?.length) return [];
  const alerts: Alert[] = [];
  for (const entry of entries) {
    const due = toDate(entry.dueAt);
    if (!due) continue;
    if (due.getTime() > now.getTime()) continue;
    const description = entry.description ?? entry.id;
    const base = entry.kind === "drain" ? ALERT_CODES.drainOverdue : ALERT_CODES.dressingOverdue;
    const kindLabel = entry.kind === "drain" ? "drenaje" : "curación";
    alerts.push({
      id: `${base}:${entry.id}`,
      code: base,
      severity: "moderate",
      message: `${kindLabel} ${description} vencido`,
      data: entry,
    });
  }
  return alerts;
}

function oxygenAlert(
  therapy: ClinicalOxygenTherapy | null | undefined,
  now: Date,
): Alert[] {
  if (!therapy?.active) return [];
  const started = toDate(therapy.start);
  if (!started) return [];
  const durationHours = hoursBetween(started, now);
  if (durationHours < OXYGEN_PROLONGED_HOURS) return [];
  const severity: AlertSeverity =
    durationHours >= OXYGEN_ESCALATE_HOURS || (therapy.fio2 ?? 0) >= HIGH_FIO2_THRESHOLD
      ? "critical"
      : "high";
  const rounded = Math.round(durationHours);
  const fio2Part = therapy.fio2 != null ? `, FiO₂ ${therapy.fio2.toFixed(2)}` : "";
  return [
    {
      id: `${ALERT_CODES.oxygenProlonged}:${therapy.start}`,
      code: ALERT_CODES.oxygenProlonged,
      severity,
      message: `Oxigenoterapia prolongada (${rounded}h${fio2Part})`,
      data: { therapy, durationHours },
    },
  ];
}

export function alertsFromData(
  input: ClinicalInput,
  opts?: { now?: () => string },
): Alert[] {
  const nowIso = opts?.now?.() ?? new Date().toISOString();
  const now = toDate(nowIso) ?? new Date();

  const alerts: Alert[] = [];

  if (input.vitals) {
    const breakdown = computeNEWS2({
      rr: input.vitals.rr,
      spo2: input.vitals.spo2,
      temp: input.vitals.temp,
      sbp: input.vitals.sbp,
      hr: input.vitals.hr,
      o2: input.vitals.o2,
      avpu: input.vitals.avpu,
      scale2: input.vitals.scale2,
    });
    alerts.push(buildNews2Alert(breakdown));
  }

  alerts.push(
    ...catheterAlerts(input.lines, now),
    ...woundCareAlerts(input.woundCare, now),
    ...oxygenAlert(input.oxygenTherapy, now),
  );

  if (input.medications?.length && input.allergies?.length) {
    for (const med of input.medications) {
      const conflictingAllergy = hasAllergyConflict(med, input.allergies);
      if (!conflictingAllergy) continue;
      alerts.push({
        id: `${ALERT_CODES.allergyConflict}:${med.id}:${conflictingAllergy.id}`,
        code: ALERT_CODES.allergyConflict,
        severity: "critical",
        message: `Alergia a ${conflictingAllergy.substance} en medicación ${med.name}`,
        data: { medication: med, allergy: conflictingAllergy },
      });
    }
  }

  alerts.sort((a, b) => {
    const severityRank: Record<AlertSeverity, number> = {
      critical: 3,
      high: 2,
      moderate: 1,
      low: 0,
    };
    const diff = severityRank[b.severity] - severityRank[a.severity];
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  return alerts;
}

export const alertsFrom = alertsFromData;
