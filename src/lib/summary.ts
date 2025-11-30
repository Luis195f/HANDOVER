// Fase 3 – Bloque B (SBAR): generación de resúmenes SBAR a partir de HandoverFormValues.
import { computeNEWS2 } from "./news2";
import type {
  FluidBalanceInfo,
  HandoverValues,
  OxygenTherapy,
  PainAssessment,
  RiskFlags,
} from "../types/handover";
import type { HandoverFormData } from "../validation/schemas";
import type { SBARSummary } from "@/src/types/sbar";

export type SbarSection = "situation" | "background" | "assessment" | "recommendation";
export type SbarSummary = SBARSummary;

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

const BRADEN_LABELS: Record<NonNullable<HandoverValues["braden"]>["riskLevel"], string> = {
  alto: "alto",
  moderado: "moderado",
  bajo: "bajo",
  sin_riesgo: "sin riesgo",
};

function truncateText(value: string, limit?: number): string {
  if (!limit || value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const lastSpace = slice.lastIndexOf(" ");
  const safeCut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}…`;
}

function joinSentences(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(". ");
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
  const diagnosis = data.dxMedical || data.dxNursing;
  const admission = diagnosis ? `Paciente con ${diagnosis}` : "Paciente con información parcial disponible";
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
  const newsText = news2 ? `NEWS2 ${news2.total} (${NEWS2_BAND_LABEL[news2.band]} riesgo)` : undefined;
  const oxygen = formatOxygenTherapy(data.oxygenTherapy);
  const evolution = data.evolution ? `Evolución: ${data.evolution}` : undefined;
  const situation = joinSentences([admission, newsText, oxygen, evolution]);
  return situation || "Paciente con información parcial disponible. Revisar historia clínica y registro de enfermería.";
}

function buildBackground(data: HandoverValues): string {
  const antecedentes: string[] = [];
  if (data.dxNursing && data.dxMedical) antecedentes.push(`Cuadro mixto: ${data.dxMedical}; ${data.dxNursing}`);
  const diet = data.nutrition?.dietType ? `Dieta ${data.nutrition.dietType}` : undefined;
  const mobility = describeMobility(data.mobility?.mobilityLevel, data.mobility?.repositioningPlan);
  const skin = data.skin?.skinStatus ? `Piel: ${data.skin.skinStatus}` : undefined;
  const allergies = data.bedsideChecklist?.allergiesReviewed ? "Alergias revisadas" : undefined;
  antecedentes.push(...[diet, mobility, skin, allergies].filter(Boolean));
  const background = antecedentes.join(". ");
  return background || "Antecedentes relevantes recogidos en la historia clínica, revisar para más detalles.";
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
  if (news2) parts.push(`NEWS2 ${news2.total} (${NEWS2_BAND_LABEL[news2.band]} riesgo)`);

  const oxygen = formatOxygenTherapy(data.oxygenTherapy);
  if (oxygen) parts.push(oxygen);

  const risks = describeRisks(data.risks);
  if (risks) parts.push(risks);

  const pain = describePain(data.painAssessment);
  if (pain) parts.push(pain);

  const balance = describeFluidBalance(data.fluidBalance);
  if (balance) parts.push(balance);

  const braden = data.braden ? `Braden ${data.braden.totalScore} (${BRADEN_LABELS[data.braden.riskLevel]} riesgo)` : undefined;
  if (braden) parts.push(braden);

  const glasgow = data.glasgow ? `Glasgow ${data.glasgow.total} (${data.glasgow.severity})` : undefined;
  if (glasgow) parts.push(glasgow);

  const assessment = parts.join(". ");
  return assessment || "Paciente sin hallazgos críticos reportados. Mantener vigilancia estándar.";
}

function buildRecommendation(data: HandoverValues): string {
  const tasks: string[] = [];
  if (data.meds) tasks.push(`Medicaciones pendientes: ${data.meds}`);
  if (data.treatments?.length) tasks.push("Procedimientos/curas programadas revisar hoja de tratamientos");
  if (data.painAssessment?.hasPain) tasks.push("Control del dolor según plan");
  if (data.risks?.fall || data.risks?.pressureUlcer || data.risks?.isolation) {
    const risks = describeRisks(data.risks);
    if (risks) tasks.push(`Vigilar ${risks.replace("Riesgos: ", "")}`);
  }
  if (data.fluidBalance?.notes) tasks.push(`Balance/diuresis: ${data.fluidBalance.notes}`);
  if (data.evolution) tasks.push(`Seguir plan: ${data.evolution}`);
  if (!tasks.length) {
    tasks.push("Control de signos vitales cada 4-6 h y revisar diuresis si aplica");
  }
  return tasks.join(". ");
}

export function generateSBARSummary(handover: HandoverFormData, options: SbarOptions = {}): SBARSummary {
  const maxChars = options.maxCharsPerSection;
  const raw: SBARSummary = {
    situation: buildSituation(handover),
    background: buildBackground(handover),
    assessment: buildAssessment(handover),
    recommendation: buildRecommendation(handover),
  };

  if (!maxChars) return raw;

  return {
    situation: truncateText(raw.situation, maxChars),
    background: truncateText(raw.background, maxChars),
    assessment: truncateText(raw.assessment, maxChars),
    recommendation: truncateText(raw.recommendation, maxChars),
  };
}

export const generateSbarSummary = generateSBARSummary;

export function formatSbar(summary: SBARSummary, locale: "es" | "en" = "es"): string {
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
