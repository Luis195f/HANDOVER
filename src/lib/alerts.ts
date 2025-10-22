// src/lib/alerts.ts
import { VitalsInput } from "./priority";

export type Alert = { kind: "warning" | "danger"; message: string };

export function alertsFrom(values: {
  vitals?: VitalsInput;
  checklist?: { idWristband?: boolean; linesChecked?: boolean; bedrails?: boolean; devicesOk?: boolean };
  census?: { total?: number; occupied?: number };
}) : Alert[] {
  const out: Alert[] = [];
  const v = values.vitals ?? {};

  // saturación muy baja con O2 -> alerta grave
  if (typeof v.spo2 === "number" && v.spo2 < 92 && v.o2) {
    out.push({ kind: "danger", message: "SpO₂ < 92% aún con O₂ suplementario" });
  }

  // censo inconsistente
  if ((values.census?.total ?? 0) < (values.census?.occupied ?? 0)) {
    out.push({ kind: "warning", message: "Censo inconsistente: ocupadas > total" });
  }

  // checklist cama
  const chk = values.checklist ?? {};
  for (const [k, ok] of Object.entries(chk)) {
    if (ok === false) out.push({ kind: "warning", message: `Checklist: revisar ${k}` });
  }

  return out;
}
