import { alertsFromData, Alert, ClinicalInput } from "./alerts";
import { computeNEWS2 } from "./news2";

const SEVERITY_ORDER: Record<Alert["severity"], number> = {
  critical: 3,
  high: 2,
  moderate: 1,
  low: 0,
};

function getNow(opts?: { now?: () => string }) {
  const iso = opts?.now?.() ?? new Date().toISOString();
  const date = new Date(iso);
  return { iso: date.toISOString(), date };
}

function formatOxygen(oxygen: ClinicalInput["oxygenTherapy"], now: Date) {
  if (!oxygen?.active) return undefined;
  const started = oxygen.start ? new Date(oxygen.start) : undefined;
  if (!started || Number.isNaN(started.getTime())) return undefined;
  const hours = Math.round((now.getTime() - started.getTime()) / (60 * 60 * 1000));
  const fio2 = oxygen.fio2 != null ? `FiO₂ ${oxygen.fio2.toFixed(2)}` : undefined;
  const flow = oxygen.flowLpm != null ? `${oxygen.flowLpm} L/min` : undefined;
  const descriptor = [fio2, flow].filter(Boolean).join(", ");
  const details = descriptor ? `${descriptor} desde ${started.toISOString()} (${hours}h)` : `desde ${started.toISOString()} (${hours}h)`;
  return `Oxígeno ${details}`;
}

function normaliseGlucose(value: number, unit: "mg/dL" | "mmol/L") {
  if (unit === "mg/dL") return value;
  return Math.round(value * 18); // conversión aproximada
}

function extractGlucoseFlag(data: ClinicalInput) {
  const readings = data.glucoseReadings;
  if (!readings?.length) return { flag: null, detail: undefined as string | undefined };
  const sorted = [...readings].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const latest = sorted[0];
  const value = normaliseGlucose(latest.value, latest.unit);
  if (value < 70) {
    return { flag: "hypo" as const, detail: `Hipoglucemia ${value} mg/dL a ${latest.takenAt}` };
  }
  if (value >= 180) {
    return { flag: "hyper" as const, detail: `Hiperglucemia ${value} mg/dL a ${latest.takenAt}` };
  }
  return { flag: null, detail: undefined };
}

function collectCriticalMeds(data: ClinicalInput): string[] | undefined {
  const meds = data.medications?.filter(med => med.critical).map(med => med.name);
  const manual = data.medsCritical ?? [];
  const merged = [...(meds ?? []), ...manual];
  return merged.length ? Array.from(new Set(merged)) : undefined;
}

function pickTopAlerts(alerts: Alert[]): Alert[] {
  const sorted = [...alerts].sort((a, b) => {
    const diff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  return sorted.slice(0, 3);
}

export function generateTurnSummary(
  data: ClinicalInput,
  opts?: { now?: () => string },
) {
  const { iso: nowIso, date: now } = getNow(opts);
  const alerts = alertsFromData(data, { now: () => nowIso });
  const vitals = data.vitals
    ? computeNEWS2({
        rr: data.vitals.rr,
        spo2: data.vitals.spo2,
        temp: data.vitals.temp,
        sbp: data.vitals.sbp,
        hr: data.vitals.hr,
        o2: data.vitals.o2,
        avpu: data.vitals.avpu,
        scale2: data.vitals.scale2,
      })
    : undefined;

  const news2Score = vitals?.total ?? 0;
  const news2Band = vitals?.band ?? "BAJA";
  const topAlerts = pickTopAlerts(alerts);
  const oxygenSummary = formatOxygen(data.oxygenTherapy, now);
  const { flag: glucoseFlag, detail: glucoseDetail } = extractGlucoseFlag(data);
  const medsCritical = collectCriticalMeds(data);

  const patientName = data.patient?.name ?? "Paciente sin identificar";
  const diagnosis = data.patient?.diagnosis;

  const lines: string[] = [];
  lines.push(`S: ${patientName} con NEWS2 ${news2Score} (${news2Band}).`);
  if (diagnosis) {
    lines.push(`B: ${diagnosis}.`);
  } else {
    lines.push("B: Sin diagnóstico documentado.");
  }

  if (topAlerts.length) {
    lines.push(`A: Alertas principales - ${topAlerts.map(a => a.message).join("; ")}.`);
  } else {
    lines.push("A: Sin alertas activas.");
  }

  const recommendations: string[] = [];
  if (oxygenSummary) recommendations.push(oxygenSummary);
  if (glucoseDetail) recommendations.push(glucoseDetail);
  if (medsCritical?.length) recommendations.push(`Medicación crítica: ${medsCritical.join(", ")}`);
  if (!recommendations.length) recommendations.push("Vigilar y continuar plan vigente.");
  lines.push(`R: ${recommendations.join(" | ")}`);

  const text = lines.join("\n");

  return {
    text,
    highlights: {
      news2: news2Score,
      band: news2Band,
      alertsTop: topAlerts,
      oxygen: oxygenSummary,
      glucoseFlag,
      medsCritical: medsCritical ?? [],
    },
  };
}
