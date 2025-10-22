import { notifyNews2Alert } from "../../lib/notifications";

export type News2Inputs = {
  rr: number; spo2: number; spo2Scale2?: boolean; onO2?: boolean;
  temp: number; sbp: number; hr: number; acvpu: "A"|"C"|"V"|"P"|"U";
};

export function classifyNews2(score: number, anyThree: boolean) {
  if (score >= 7 || anyThree) return "critical" as const;
  if (score >= 5) return "urgent" as const;
  return null;
}

export async function checkNews2AndNotify(opts: {
  patientName: string;
  news2Score: number;
  anyThree: boolean; // true si hay "cualquier 3"
}) {
  const level = classifyNews2(opts.news2Score, opts.anyThree);
  if (!level) return;

  const suggestions =
    level === "critical"
      ? ["Revaluar en 5–15 min", "Avisar a equipo médico", "Monitor continuo"]
      : ["Revaluar en 30 min", "Ajustar monitorización", "Revisar pendientes"];

  await notifyNews2Alert(opts.patientName, opts.news2Score, level, suggestions);
}
