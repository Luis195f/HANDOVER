// src/lib/priority.ts

/** Escala de consciencia (NEWS2). */
export type ACVPU = "A" | "C" | "V" | "P" | "U";

/** Vitals de entrada para calcular NEWS2 (escala 1 para SpO₂). */
export type VitalsInput = {
  rr?: number;   // frecuencia respiratoria /min
  hr?: number;   // frecuencia cardiaca /min
  sbp?: number;  // TAS mmHg
  temp?: number; // °C
  spo2?: number; // %
  o2?: boolean;  // en O₂ suplementario
  acvpu?: ACVPU; // nivel de consciencia
};

/** Calcula el puntaje NEWS2 (escala 1 para SpO₂). */
export function news2Score(v: VitalsInput): number {
  const rr  = v.rr   ?? NaN;
  const hr  = v.hr   ?? NaN;
  const sbp = v.sbp  ?? NaN;
  const t   = v.temp ?? NaN;
  const sp  = v.spo2 ?? NaN;

  let s = 0;

  // FR (respiratory rate)
  if (!Number.isNaN(rr)) {
    if (rr <= 8) s += 3;
    else if (rr <= 11) s += 1;
    else if (rr <= 20) s += 0;
    else if (rr <= 24) s += 2;
    else s += 3;
  }

  // SpO2 (escala 1)
  if (!Number.isNaN(sp)) {
    if (sp <= 91) s += 3;
    else if (sp <= 93) s += 2;
    else if (sp <= 95) s += 1;
    else s += 0;
  }
  if (v.o2) s += 2;

  // Temperatura
  if (!Number.isNaN(t)) {
    if (t <= 35.0) s += 3;
    else if (t <= 36.0) s += 1;
    else if (t <= 38.0) s += 0;
    else if (t <= 39.0) s += 1;
    else s += 2;
  }

  // TAS (systolic BP)
  if (!Number.isNaN(sbp)) {
    if (sbp <= 90) s += 3;
    else if (sbp <= 100) s += 2;
    else if (sbp <= 110) s += 1;
    else if (sbp <= 219) s += 0;
    else s += 3;
  }

  // FC (heart rate)
  if (!Number.isNaN(hr)) {
    if (hr <= 40) s += 3;
    else if (hr <= 50) s += 1;
    else if (hr <= 90) s += 0;
    else if (hr <= 110) s += 1;
    else if (hr <= 130) s += 2;
    else s += 3;
  }

  // ACVPU (no-Alert suma 3)
  if (v.acvpu && v.acvpu !== "A") s += 3;

  return s;
}

/** Mapea NEWS2 a etiqueta/coloress (ES) para UI existente. */
export function news2PriorityTag(score: number): { level: "Crítico"|"Alto"|"Moderado"|"Bajo"; color: string } {
  if (score >= 7) return { level: "Crítico",  color: "#b91c1c" };  // rojo
  if (score >= 5) return { level: "Alto",     color: "#ea580c" };  // naranja
  if (score >= 3) return { level: "Moderado", color: "#ca8a04" };  // ámbar
  return               { level: "Bajo",      color: "#15803d" };   // verde
}

/** Compatibilidad con código previo (no romper). */
export function priorityLabel(score: number): "Crítico"|"Alto"|"Moderado"|"Bajo" {
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

/** Export por defecto (sigue funcionando con import default). */
const Priority = {
  news2Score,
  news2PriorityTag,
  priorityLabel,
  priorityColor,
  priorityFromNews2,
  sortByPriority,
};
export default Priority;
