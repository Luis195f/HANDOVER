import { computeNEWS2 } from './news2';
import { generateSBARSummary, type SbarOptions } from './summary';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

export interface AISummaryProvider {
  (handover: HandoverFormData, draft: SBARSummary): Promise<SBARSummary | null | undefined>;
}

export interface DegradedSummaryOptions {
  aiProvider?: AISummaryProvider;
  useLocalRules?: boolean;
  sbarOptions?: SbarOptions;
}

const RISK_LABELS: Record<string, string> = {
  fall: 'caídas',
  pressureUlcer: 'úlceras por presión',
  isolation: 'aislamiento',
  seizure: 'convulsiones',
  suicide: 'riesgo suicida',
  deviceDisconnection: 'desconexión de dispositivos',
  infection: 'infección',
  other: 'otro',
};

function safeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function resolveDiagnosis(handover: HandoverFormData): string {
  if (handover.dxMedical?.display) return handover.dxMedical.display;
  if (handover.dxNursing?.display) return handover.dxNursing.display;
  const fromStructured = handover.dxMedicalStructured?.[0]?.display || handover.dxNursingStructured?.[0]?.display;
  return safeString(fromStructured, 'Diagnóstico no disponible');
}

function buildRiskSummary(handover: HandoverFormData): string | undefined {
  const risks = handover.risks ?? {};
  const structured = handover.risksStructured ?? [];
  const labels = new Set<string>();

  Object.keys(risks)
    .filter((key) => (risks as Record<string, unknown>)[key])
    .forEach((key) => labels.add(RISK_LABELS[key] ?? key));

  structured
    .filter((item) => item.present)
    .forEach((item) => labels.add(RISK_LABELS[item.type] ?? item.type));

  if (!labels.size) return undefined;
  return `Riesgos: ${Array.from(labels).join(', ')}`;
}

function buildMinimalSummary(handover: HandoverFormData): SBARSummary {
  const diagnosis = resolveDiagnosis(handover);
  const news2 = handover.vitals
    ? computeNEWS2({
        rr: handover.vitals.rr,
        spo2: handover.vitals.spo2,
        temp: handover.vitals.tempC,
        sbp: handover.vitals.sbp,
        hr: handover.vitals.hr,
        o2: Boolean(handover.oxygenTherapy),
        avpu: handover.vitals.avpu,
        scale2: false,
      })
    : null;
  const newsText = news2 ? `NEWS2 ${news2.total} (${news2.band.toLowerCase()} riesgo)` : 'NEWS2 no disponible';
  const risks = buildRiskSummary(handover) ?? 'Riesgos: no reportados';
  const oxygen = handover.oxygenTherapy?.device ? `Oxígeno: ${handover.oxygenTherapy.device}` : null;
  const recommendation = news2 && news2.total >= 5
    ? 'Monitorizar de cerca y avisar a equipo médico'
    : 'Vigilancia estándar y pasar visita según plan';

  return {
    situation: `Paciente con ${diagnosis}. ${newsText}`.trim(),
    background: safeString(handover.evolution, 'Antecedentes breves no disponibles'),
    assessment: [newsText, risks, oxygen].filter(Boolean).join('. '),
    recommendation,
  };
}

function ensureSbar(summary: SBARSummary | null | undefined, fallback: SBARSummary): SBARSummary {
  if (!summary) return fallback;
  const safe: SBARSummary = { ...fallback };
  return {
    situation: safeString(summary.situation, fallback.situation),
    background: safeString(summary.background, fallback.background),
    assessment: safeString(summary.assessment, fallback.assessment),
    recommendation: safeString(summary.recommendation, fallback.recommendation),
  };
}

export async function getBestAvailableSummary(
  handover: HandoverFormData,
  options: DegradedSummaryOptions = {},
): Promise<SBARSummary> {
  const { aiProvider, useLocalRules = true, sbarOptions } = options;
  const draft = (() => {
    try {
      return generateSBARSummary(handover, sbarOptions);
    } catch (error) {
      return buildMinimalSummary(handover);
    }
  })();

  if (aiProvider) {
    try {
      const aiSummary = await aiProvider(handover, draft);
      const refined = ensureSbar(aiSummary, draft);
      if (refined) return refined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
    }
  }

  if (useLocalRules) {
    return draft;
  }

  return buildMinimalSummary(handover);
}

export const getDegradedSbarSummary = getBestAvailableSummary;
export const buildMinimalSbarSummary = buildMinimalSummary;
