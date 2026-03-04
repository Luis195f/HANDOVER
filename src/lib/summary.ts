// Fase 3 – Bloque B (SBAR): generación de resúmenes SBAR a partir de HandoverFormValues.
import { computeNEWS2 } from "./news2";
import type { HandoverFormData, HandoverValues } from "../validation/schemas";
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

type RiskFlags = NonNullable<HandoverValues["risks"]>;
type RiskItem = NonNullable<HandoverValues["risksStructured"]>[number];
type RiskType = RiskItem["type"];
type OxygenTherapy = HandoverValues["oxygenTherapy"];
type PainAssessment = HandoverValues["painAssessment"];
type FluidBalanceInfo = HandoverValues["fluidBalance"];

const RISK_LABELS: Record<keyof RiskFlags, string> = {
  fall: "caídas",
  pressureUlcer: "úlceras por presión",
  isolation: "aislamiento",
};

const RISK_TYPE_LABELS: Record<RiskType, string> = {
  fall: "caídas",
  pressureUlcer: "úlceras por presión",
  isolation: "aislamiento",
  seizure: "convulsiones",
  suicide: "riesgo suicida",
  deviceDisconnection: "desconexión de dispositivos",
  infection: "infección",
  other: "otro",
};

const BRADEN_LABELS: Record<NonNullable<HandoverValues["braden"]>["riskLevel"], string> = {
  alto: "alto",
  moderado: "moderado",
  bajo: "bajo",
  sin_riesgo: "sin riesgo",
};

const isNonEmptyString = (value: string | undefined | null): value is string =>
  typeof value === "string" && value.length > 0;

function truncateText(value: string, limit?: number): string {
  if (!limit || value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const lastSpace = slice.lastIndexOf(" ");
  const safeCut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}…`;
}

function joinSentences(parts: Array<string | undefined>): string {
  return parts.filter(isNonEmptyString).join(". ");
}

const getDxMedicalDisplay = (dx: HandoverValues["dxMedical"]): string | undefined => {
  if (!dx) return undefined;
  const display = (dx as { display?: unknown }).display;
  return typeof display === "string" && display.trim() ? display.trim() : undefined;
};

const getDxNursingText = (dx: HandoverValues["dxNursing"]): string | undefined => {
  if (typeof dx !== "string") return undefined;
  const trimmed = dx.trim();
  return trimmed ? trimmed : undefined;
};

function formatOxygenTherapy(oxygen?: OxygenTherapy): string | undefined {
  if (!oxygen) return undefined;
  const o = oxygen as any;
  const pieces: string[] = [];
  if (o.device) pieces.push(String(o.device));
  if (typeof o.flowLMin === "number") pieces.push(`${o.flowLMin} L/min`);
  if (typeof o.fio2 === "number") pieces.push(`FiO2 ${o.fio2}%`);
  return pieces.length ? `Oxígeno: ${pieces.join(" | ")}` : undefined;
}

function isSupplementalOxygen(oxygen?: OxygenTherapy): boolean {
  if (!oxygen) return false;
  const o = oxygen as any;
  const device = typeof o.device === "string" ? o.device.toLowerCase().trim() : "";
  const hasDevice = device && device !== "aire ambiente";
  return Boolean(hasDevice || o.flowLMin != null || o.fio2 != null);
}

function collectRiskLabels(risks?: RiskFlags, structured: RiskItem[] = []): string[] {
  const labels = new Set<string>();
  if (risks) {
    (Object.keys(risks) as Array<keyof RiskFlags>).forEach((key) => {
      if ((risks as any)[key]) labels.add(RISK_LABELS[key]);
    });
  }

  structured
    .filter((item) => item.present)
    .forEach((item) => {
      const label = (RISK_TYPE_LABELS as any)[item.type] ?? item.type;
      labels.add(label);
    });

  return Array.from(labels);
}

function describeRisks(risks?: RiskFlags, structured?: RiskItem[]): string | undefined {
  const active = collectRiskLabels(risks, structured ?? []);
  return active.length ? `Riesgos: ${active.join(", ")}` : undefined;
}

function describePain(pain?: PainAssessment): string | undefined {
  const p = pain as any;
  if (!p?.hasPain) return undefined;
  const eva = typeof p.evaScore === "number" ? `EVA ${p.evaScore}` : undefined;
  const location = p.location ? `en ${p.location}` : undefined;
  const details = [eva, location].filter(isNonEmptyString).join(" ");
  return details ? `Dolor ${details}` : "Dolor reportado";
}

function describeFluidBalance(balance?: FluidBalanceInfo): string | undefined {
  const b = balance as any;
  if (!b) return undefined;
  const hasNumbers = typeof b.intakeMl === "number" || typeof b.outputMl === "number";
  const parts: string[] = [];
  if (hasNumbers) {
    const intake = typeof b.intakeMl === "number" ? `${b.intakeMl} ml in` : undefined;
    const output = typeof b.outputMl === "number" ? `${b.outputMl} ml out` : undefined;
    const net = typeof b.netBalanceMl === "number" ? `neto ${b.netBalanceMl} ml` : undefined;
    parts.push([intake, output, net].filter(Boolean).join(" / "));
  }
  if (b.notes) parts.push(String(b.notes));
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
  const diagnosis = getDxMedicalDisplay(data.dxMedical) ?? getDxNursingText(data.dxNursing);
  const admission = diagnosis ? `Paciente con ${diagnosis}` : "Paciente con información parcial disponible";
  const location = data.administrativeData?.unit ? `Ubicación: ${data.administrativeData.unit}` : undefined;

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

  const situation = joinSentences([admission, location, newsText, oxygen, evolution]);
  return situation || "Paciente con información parcial disponible. Revisar historia clínica y registro de enfermería.";
}

function buildBackground(data: HandoverValues): string {
  const antecedentes: string[] = [];

  const medical = getDxMedicalDisplay(data.dxMedical);
  const nursing = getDxNursingText(data.dxNursing);
  if (medical && nursing) antecedentes.push(`Cuadro mixto: ${medical}; ${nursing}`);

  const diet = data.nutrition?.dietType ? `Dieta ${data.nutrition.dietType}` : undefined;
  const mobility = describeMobility(data.mobility?.mobilityLevel, data.mobility?.repositioningPlan);
  const skin = data.skin?.skinStatus ? `Piel: ${data.skin.skinStatus}` : undefined;
  const allergies = data.bedsideChecklist?.allergiesReviewed ? "Alergias revisadas" : undefined;
  const bedsideNotes = (data.bedsideChecklist as any)?.bedsideNotes;

  antecedentes.push(...[diet, mobility, skin, allergies, bedsideNotes].filter(isNonEmptyString));
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

  const risks = describeRisks(data.risks ?? undefined, (data.risksStructured ?? []) as any);
  if (risks) parts.push(risks);

  const pain = describePain(data.painAssessment);
  if (pain) parts.push(pain);

  const balance = describeFluidBalance(data.fluidBalance);
  if (balance) parts.push(balance);

  const braden = data.braden
    ? `Braden ${data.braden.totalScore} (${BRADEN_LABELS[data.braden.riskLevel]} riesgo)`
    : undefined;
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
  if ((data.painAssessment as any)?.hasPain) tasks.push("Control del dolor según plan");

  if ((data.risks && Object.values(data.risks as any).some(Boolean)) || (data.risksStructured?.length ?? 0) > 0) {
    const risks = describeRisks(data.risks ?? undefined, (data.risksStructured ?? []) as any);
    if (risks) tasks.push(`Vigilar ${risks.replace("Riesgos: ", "")}`);
  }

  if ((data.fluidBalance as any)?.notes) tasks.push(`Balance/diuresis: ${(data.fluidBalance as any).notes}`);
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

export function generateSbarText(data: HandoverFormData, options: SbarOptions = {}): string {
  const summary = generateSbarSummary(data, options);
  return formatSbar(summary, options.locale ?? "es");
}
