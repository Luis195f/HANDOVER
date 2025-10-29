import { Alert, AlertSeverity } from "./alerts";
import { computeNEWS2, ACVPU as NEWS2ACVPU } from "./news2";

/** Escala de consciencia (NEWS2). */
export type ACVPU = NEWS2ACVPU;

/** Vitals de entrada para calcular NEWS2 (escala 1 por defecto). */
export type VitalsInput = {
  rr?: number;
  hr?: number;
  sbp?: number;
  dbp?: number;
  temp?: number;
  spo2?: number;
  o2?: boolean;
  o2Device?: string;
  o2FlowLpm?: number;
  fio2?: number;
  acvpu?: ACVPU;
  scale2?: boolean;
};

/** Calcula el puntaje NEWS2 reutilizando computeNEWS2. */
export function news2Score(v: VitalsInput): number {
  const breakdown = computeNEWS2({
    rr: v.rr,
    spo2: v.spo2,
    temp: v.temp,
    sbp: v.sbp,
    hr: v.hr,
    o2: v.o2,
    avpu: v.acvpu,
    scale2: v.scale2,
  });
  return breakdown.total;
}

/** Mapea NEWS2 a etiqueta/coloress (ES) para UI existente. */
export function news2PriorityTag(score: number): {
  level: "Crítico" | "Alto" | "Moderado" | "Bajo";
  color: string;
} {
  if (score >= 7) return { level: "Crítico", color: "#b91c1c" };
  if (score >= 5) return { level: "Alto", color: "#ea580c" };
  if (score >= 3) return { level: "Moderado", color: "#ca8a04" };
  return { level: "Bajo", color: "#15803d" };
}

/** Compatibilidad con código previo (no romper). */
export function priorityLabel(score: number): "Crítico" | "Alto" | "Moderado" | "Bajo" {
  return news2PriorityTag(score).level;
}

export function priorityColor(score: number): string {
  return news2PriorityTag(score).color;
}

/** 🔹 Lo que pediste: nivel simple en inglés para listados (low/medium/high). */
export type PrioritySimple = "low" | "medium" | "high";

export function priorityFromNews2(score: number): PrioritySimple {
  if (score >= 7) return "high";
  if (score >= 5) return "medium";
  return "low";
}

/** 🔹 Lo que pediste: ordena pacientes por criticidad (estable). */
export function sortByPriority<T extends { id: string; news2: number }>(patients: T[]): T[] {
  return patients
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (b.p.news2 !== a.p.news2) return b.p.news2 - a.p.news2;
      return a.i - b.i; // estabilidad en empates
    })
    .map(x => x.p);
}

export type ClinicalPatientSummary = {
  id: string;
  name: string;
  news2: number;
  band?: "BAJA" | "MEDIA" | "ALTA" | "CRÍTICA";
  alerts?: Alert[];
  glucoseFlag?: "hypo" | "hyper" | null;
  oxygen?: {
    active: boolean;
    start?: string;
    prolonged?: boolean;
  } | null;
  lastUpdated?: string;
  recentChangeAt?: string;
};

export function computePriorityList(
  patients: ClinicalPatientSummary[],
): Array<ClinicalPatientSummary & { priority: number; reason: string[] }> {
  const severityRank: Record<AlertSeverity, number> = {
    critical: 3,
    high: 2,
    moderate: 1,
    low: 0,
  };
  const glucoseRank: Record<NonNullable<ClinicalPatientSummary["glucoseFlag"]>, number> = {
    hypo: 2,
    hyper: 1,
  };
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  const enriched = patients.map(patient => {
    const band = patient.band ?? (patient.news2 >= 7 ? "CRÍTICA" : patient.news2 >= 5 ? "ALTA" : patient.news2 >= 1 ? "MEDIA" : "BAJA");
    const maxAlert = (patient.alerts ?? []).reduce<{ alert: Alert | null; rank: number }>(
      (acc, alert) => {
        const rank = severityRank[alert.severity];
        if (rank > acc.rank) return { alert, rank };
        return acc;
      },
      { alert: null, rank: -1 },
    );
    const glucoseRankValue = patient.glucoseFlag ? glucoseRank[patient.glucoseFlag] : 0;
    const oxygenRank = patient.oxygen?.active ? (patient.oxygen.prolonged ? 2 : 1) : 0;
    const oxygenReason = patient.oxygen?.active
      ? patient.oxygen.prolonged
        ? `Oxígeno prolongado desde ${patient.oxygen.start ?? "fecha desconocida"}`
        : `Oxígeno activo${patient.oxygen.start ? ` desde ${patient.oxygen.start}` : ""}`
      : undefined;
    const recentChange = patient.recentChangeAt
      ? (() => {
          const ts = new Date(patient.recentChangeAt);
          if (Number.isNaN(ts.getTime())) return false;
          const now = new Date();
          return now.getTime() - ts.getTime() <= SIX_HOURS_MS;
        })()
      : false;
    const lastUpdatedMs = patient.lastUpdated ? new Date(patient.lastUpdated).getTime() : 0;

    const priority =
      patient.news2 * 10 +
      maxAlert.rank * 5 +
      glucoseRankValue * 2 +
      oxygenRank * 3 +
      (recentChange ? 1 : 0);

    const reason: string[] = [`NEWS2 ${patient.news2} (${band})`];
    if (maxAlert.alert) {
      reason.push(`Alerta ${maxAlert.alert.severity}: ${maxAlert.alert.message}`);
    }
    if (patient.glucoseFlag === "hypo") {
      reason.push("Hipoglucemia reciente");
    } else if (patient.glucoseFlag === "hyper") {
      reason.push("Hiperglucemia reciente");
    }
    if (oxygenReason) {
      reason.push(oxygenReason);
    }
    if (recentChange) {
      reason.push("Cambio clínico <6h");
    }

    return {
      ...patient,
      band,
      priority,
      reason,
      _meta: {
        maxAlertSeverity: maxAlert.rank,
        glucoseRank: glucoseRankValue,
        oxygenRank,
        recentChange,
        lastUpdatedMs,
      },
    };
  });

  enriched.sort((a, b) => {
    if (b.news2 !== a.news2) return b.news2 - a.news2;
    if (b._meta.maxAlertSeverity !== a._meta.maxAlertSeverity) return b._meta.maxAlertSeverity - a._meta.maxAlertSeverity;
    if (b._meta.glucoseRank !== a._meta.glucoseRank) return b._meta.glucoseRank - a._meta.glucoseRank;
    if (b._meta.oxygenRank !== a._meta.oxygenRank) return b._meta.oxygenRank - a._meta.oxygenRank;
    if (Number(b._meta.recentChange) !== Number(a._meta.recentChange)) return Number(b._meta.recentChange) - Number(a._meta.recentChange);
    if (b._meta.lastUpdatedMs !== a._meta.lastUpdatedMs) return b._meta.lastUpdatedMs - a._meta.lastUpdatedMs;
    return a.id.localeCompare(b.id);
  });

  return enriched.map(({ _meta: _meta, ...rest }) => rest);
}

/** Export por defecto (sigue funcionando con import default). */
const Priority = {
  news2Score,
  news2PriorityTag,
  priorityLabel,
  priorityColor,
  priorityFromNews2,
  sortByPriority,
  computePriorityList,
};

export default Priority;
