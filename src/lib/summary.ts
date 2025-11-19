// Fase 3 – Bloque B (SBAR): generación de resúmenes SBAR a partir de HandoverFormValues.
import { computeNEWS2 } from "./news2";
import type { HandoverValues, OxygenTherapy, RiskFlags, PainAssessment, FluidBalanceInfo } from "../types/handover";

export type SbarSection = "situation" | "background" | "assessment" | "recommendation";

export interface SbarSummary {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

export interface SbarOptions {
  locale?: "es" | "en";
  maxCharsPerSection?: number;
}

const NEWS2_BAND_LABEL: Record<ReturnType<typeof computeNEWS2>["band"], string> = {
  BAJA: "bajo",
  MEDIA: "moderado",
  ALTA: "alto",
  CRÍTICA: "crítico",
};

const RISK_LABELS: Record<keyof RiskFlags, string> = {
  fall: "caídas",
  pressureUlcer: "úlceras por presión",
  isolation: "aislamiento",
};

function truncateText(value: string, limit?: number): string {
  if (!limit || value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const lastSpace = slice.lastIndexOf(" ");
  const safeCut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}…`;
}

function formatOxygenTherapy(oxygen?: OxygenTherapy): string | undefined {
  if (!oxygen) return undefined;
  const pieces: string[] = [];
  if (oxygen.device) pieces.push(oxygen.device);
  if (typeof oxygen.flowLMin === "number") pieces.push(`${oxygen.flowLMin} L/min`);
  if (typeof oxygen.fio2 === "number") pieces.push(`FiO2 ${oxygen.fio2}%`);
  return pieces.length ? `Oxígeno: ${pieces.join(" | ")}` : undefined;
}

function isSupplementalOxygen(oxygen?: OxygenTherapy): boolean {
  if (!oxygen) return false;
  const device = oxygen.device?.toLowerCase().trim();
  const hasDevice = device && device !== "aire ambiente";
  return Boolean(hasDevice || oxygen.flowLMin != null || oxygen.fio2 != null);
}

function describeRisks(risks?: RiskFlags): string | undefined {
  if (!risks) return undefined;
  const active = (Object.keys(risks) as Array<keyof RiskFlags>)
    .filter((key) => risks[key])
    .map((key) => RISK_LABELS[key]);
  return active.length ? `Riesgos: ${active.join(", ")}` : undefined;
}

function describePain(pain?: PainAssessment): string | undefined {
  if (!pain?.hasPain) return undefined;
  const eva = typeof pain.evaScore === "number" ? `EVA ${pain.evaScore}` : undefined;
  const location = pain.location ? `en ${pain.location}` : undefined;
  const details = [eva, location].filter(Boolean).join(" ");
  return details ? `Dolor ${details}` : "Dolor reportado";
}

function describeFluidBalance(balance?: FluidBalanceInfo): string | undefined {
  if (!balance) return undefined;
  const hasNumbers = typeof balance.intakeMl === "number" || typeof balance.outputMl === "number";
  const parts: string[] = [];
  if (hasNumbers) {
    const intake = typeof balance.intakeMl === "number" ? `${balance.intakeMl} ml in` : undefined;
    const output = typeof balance.outputMl === "number" ? `${balance.outputMl} ml out` : undefined;
    const net = typeof balance.netBalanceMl === "number" ? `neto ${balance.netBalanceMl} ml` : undefined;
    parts.push([intake, output, net].filter(Boolean).join(" / "));
  }
  if (balance.notes) parts.push(balance.notes);
  return parts.filter(Boolean).length ? `Balance hídrico: ${parts.filter(Boolean).join(". ")}` : undefined;
}

function describeMobility(mobilityLevel?: string, repositioningPlan?: string): string | undefined {
  if (!mobilityLevel && !repositioningPlan) return undefined;
  const details: string[] = [];
  if (mobilityLevel) details.push(`Movilidad: ${mobilityLevel}`);
  if (repositioningPlan) details.push(repositioningPlan);
  return details.join(". ");
}

function buildSituation(data: HandoverValues): string {
  const patientId = data.patientId ? `Paciente ${data.patientId}` : "Paciente sin identificar";
  const diagnosis = data.dxMedical || data.dxNursing;
  const oxygen = formatOxygenTherapy(data.oxygenTherapy);
  const pain = describePain(data.painAssessment);
  const statusParts = [oxygen, pain, data.evolution]?.filter(Boolean);
  const status = statusParts.length ? `Estado actual: ${statusParts.join(" | ")}` : undefined;
  return [patientId, diagnosis ? `Dx: ${diagnosis}` : undefined, status].filter(Boolean).join(". ");
}

function buildBackground(data: HandoverValues): string {
  const antecedentes: string[] = [];
  if (data.dxNursing && data.dxMedical) {
    antecedentes.push(`Enf.: ${data.dxNursing}`);
  }
  if (data.nutrition?.dietType) {
    antecedentes.push(`Dieta: ${data.nutrition.dietType}`);
  }
  const mobility = describeMobility(data.mobility?.mobilityLevel, data.mobility?.repositioningPlan);
  if (mobility) antecedentes.push(mobility);
  if (data.skin?.skinStatus) antecedentes.push(`Piel: ${data.skin.skinStatus}`);
  return antecedentes.join(". ") || "Sin antecedentes relevantes documentados.";
}

function buildAssessment(data: HandoverValues): string {
  const vitals = data.vitals;
  const news2 = vitals
    ? computeNEWS2({
        rr: vitals.rr,
        spo2: vitals.spo2,
        temp: vitals.tempC,
        sbp: vitals.sbp,
        hr: vitals.hr,
        o2: isSupplementalOxygen(data.oxygenTherapy),
        avpu: vitals.avpu,
        scale2: false,
      })
    : undefined;

  const parts: string[] = [];
  if (news2) {
    const bandLabel = NEWS2_BAND_LABEL[news2.band];
    parts.push(`NEWS2 ${news2.total} (${bandLabel})`);
  }

  const oxygen = formatOxygenTherapy(data.oxygenTherapy);
  if (oxygen) parts.push(oxygen);

  const risks = describeRisks(data.risks);
  if (risks) parts.push(risks);

  const pain = describePain(data.painAssessment);
  if (pain) parts.push(pain);

  const balance = describeFluidBalance(data.fluidBalance);
  if (balance) parts.push(balance);

  return parts.join(". ") || "Sin hallazgos críticos actuales.";
}

function buildRecommendation(data: HandoverValues): string {
  const tasks: string[] = [];
  if (data.meds) tasks.push(`Medicaciones pendientes: ${data.meds}`);
  if (data.painAssessment?.hasPain) tasks.push("Control del dolor según plan");
  if (data.risks?.fall || data.risks?.pressureUlcer || data.risks?.isolation) {
    const risks = describeRisks(data.risks);
    if (risks) tasks.push(`Vigilar ${risks.replace("Riesgos: ", "")}`);
  }
  if (data.fluidBalance?.notes) tasks.push(`Balance/curas: ${data.fluidBalance.notes}`);
  if (data.evolution) tasks.push(`Seguir plan: ${data.evolution}`);
  return tasks.join(". ") || "Vigilar y continuar plan vigente.";
}

export function generateSbarSummary(data: HandoverValues, options: SbarOptions = {}): SbarSummary {
  const maxChars = options.maxCharsPerSection;

  const raw: SbarSummary = {
    situation: buildSituation(data),
    background: buildBackground(data),
    assessment: buildAssessment(data),
    recommendation: buildRecommendation(data),
  };

  if (!maxChars) return raw;

  return {
    situation: truncateText(raw.situation, maxChars),
    background: truncateText(raw.background, maxChars),
    assessment: truncateText(raw.assessment, maxChars),
    recommendation: truncateText(raw.recommendation, maxChars),
  };
}

export function formatSbar(summary: SbarSummary, locale: "es" | "en" = "es"): string {
  const labels =
    locale === "en"
      ? {
          situation: "S: Situation",
          background: "B: Background",
          assessment: "A: Assessment",
          recommendation: "R: Recommendation",
        }
      : {
          situation: "S: Situación",
          background: "B: Antecedentes",
          assessment: "A: Valoración",
          recommendation: "R: Recomendación",
        };

  return [
    `${labels.situation}: ${summary.situation}`,
    `${labels.background}: ${summary.background}`,
    `${labels.assessment}: ${summary.assessment}`,
    `${labels.recommendation}: ${summary.recommendation}`,
  ].join("\n");
}

export function generateSbarText(data: HandoverValues, options: SbarOptions = {}): string {
  const summary = generateSbarSummary(data, options);
  return formatSbar(summary, options.locale ?? "es");
}
