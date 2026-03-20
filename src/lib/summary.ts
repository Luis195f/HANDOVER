// Fase 3 – Bloque B (SBAR): generación de resúmenes SBAR a partir de HandoverFormData.
import { computeNEWS2 } from './news2';
import type {
  FluidBalanceInfo,
  ContingencyPlan,
  OxygenTherapy,
  PainAssessment,
  PendingTask,
  TurnContext,
  RiskFlags,
  RiskItem,
  RiskType,
} from '../types/handover';
import type { HandoverFormData } from '../validation/schemas';
import type { SBARSummary } from '@/src/types/sbar';

export type SbarSection = 'situation' | 'background' | 'assessment' | 'recommendation';
export type SbarSummary = SBARSummary;

export interface SbarOptions {
  locale?: 'es' | 'en';
  maxCharsPerSection?: number;
}

const NEWS2_BAND_LABEL: Record<ReturnType<typeof computeNEWS2>['band'], string> = {
  BAJA: 'bajo',
  MEDIA: 'moderado',
  ALTA: 'alto',
  CRÍTICA: 'crítico',
};

const RISK_LABELS: Record<keyof RiskFlags, string> = {
  fall: 'caídas',
  pressureUlcer: 'úlceras por presión',
  isolation: 'aislamiento',
};

const RISK_TYPE_LABELS: Record<RiskType, string> = {
  fall: 'caídas',
  pressureUlcer: 'úlceras por presión',
  isolation: 'aislamiento',
  seizure: 'convulsiones',
  suicide: 'riesgo suicida',
  deviceDisconnection: 'desconexión de dispositivos',
  infection: 'infección',
  other: 'otro',
};

const BRADEN_LABELS: Record<
  NonNullable<HandoverFormData['braden']>['riskLevel'],
  string
> = {
  alto: 'alto',
  moderado: 'moderado',
  bajo: 'bajo',
  sin_riesgo: 'sin riesgo',
};

const isNonEmptyString = (value: string | undefined | null): value is string =>
  typeof value === 'string' && value.length > 0;

function legacyDxText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : undefined;
  }
  if (value && typeof value === 'object') {
    const r = value as Record<string, unknown>;
    const display = typeof r.display === 'string' ? r.display.trim() : '';
    const code = typeof r.code === 'string' ? r.code.trim() : '';
    const out = display || code;
    return out ? out : undefined;
  }
  return undefined;
}

const getDxMedicalDisplay = (coding: HandoverFormData['dxMedical']): string | undefined => {
  const display = coding?.display?.trim();
  return display ? display : undefined;
};

const getDxNursingText = (value: HandoverFormData['dxNursing']): string | undefined => {
  return legacyDxText(value);
};

function truncateText(value: string, limit?: number): string {
  if (!limit || value.length <= limit) return value;
  const slice = value.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  const safeCut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}…`;
}

function joinSentences(parts: Array<string | undefined>): string {
  return parts.filter(isNonEmptyString).join('. ');
}

function formatOxygenTherapy(oxygen?: OxygenTherapy): string | undefined {
  if (!oxygen) return undefined;
  const pieces: string[] = [];
  if (oxygen.device) pieces.push(oxygen.device);
  if (typeof oxygen.flowLMin === 'number') pieces.push(`${oxygen.flowLMin} L/min`);
  if (typeof oxygen.fio2 === 'number') pieces.push(`FiO2 ${oxygen.fio2}%`);
  return pieces.length ? `Oxígeno: ${pieces.join(' | ')}` : undefined;
}

function isSupplementalOxygen(oxygen?: OxygenTherapy): boolean {
  if (!oxygen) return false;
  const device = oxygen.device?.toLowerCase().trim();
  const hasDevice = device && device !== 'aire ambiente';
  return Boolean(hasDevice || oxygen.flowLMin != null || oxygen.fio2 != null);
}

function collectRiskLabels(risks?: RiskFlags, structured: RiskItem[] = []): string[] {
  const labels = new Set<string>();
  if (risks) {
    (Object.keys(risks) as Array<keyof RiskFlags>).forEach((key) => {
      if (risks[key]) labels.add(RISK_LABELS[key]);
    });
  }

  structured
    .filter((item) => item.present)
    .forEach((item) => {
      const label = RISK_TYPE_LABELS[item.type] ?? item.type;
      labels.add(label);
    });

  return Array.from(labels);
}

function describeRisks(risks?: RiskFlags, structured?: RiskItem[]): string | undefined {
  const active = collectRiskLabels(risks, structured ?? []);
  return active.length ? `Riesgos: ${active.join(', ')}` : undefined;
}

function describePain(pain?: PainAssessment): string | undefined {
  if (!pain?.hasPain) return undefined;
  const eva = typeof pain.evaScore === 'number' ? `EVA ${pain.evaScore}` : undefined;
  const location = pain.location ? `en ${pain.location}` : undefined;
  const details = [eva, location].filter(isNonEmptyString).join(' ');
  return details ? `Dolor ${details}` : 'Dolor reportado';
}

function describeFluidBalance(balance?: FluidBalanceInfo): string | undefined {
  if (!balance) return undefined;
  const hasNumbers = typeof balance.intakeMl === 'number' || typeof balance.outputMl === 'number';
  const parts: string[] = [];
  if (hasNumbers) {
    const intake = typeof balance.intakeMl === 'number' ? `${balance.intakeMl} ml in` : undefined;
    const output = typeof balance.outputMl === 'number' ? `${balance.outputMl} ml out` : undefined;
    const net = typeof balance.netBalanceMl === 'number' ? `neto ${balance.netBalanceMl} ml` : undefined;
    parts.push([intake, output, net].filter(Boolean).join(' / '));
  }
  if (balance.notes) parts.push(balance.notes);
  return parts.filter(Boolean).length ? `Balance hídrico: ${parts.filter(Boolean).join('. ')}` : undefined;
}

function describeMobility(mobilityLevel?: string, repositioningPlan?: string): string | undefined {
  if (!mobilityLevel && !repositioningPlan) return undefined;
  const details: string[] = [];
  if (mobilityLevel) details.push(`Movilidad: ${mobilityLevel}`);
  if (repositioningPlan) details.push(repositioningPlan);
  return details.join('. ');
}

function describeTurnContext(turnContext?: TurnContext): string | undefined {
  if (!turnContext) return undefined;

  const parts: string[] = [];
  if (turnContext.workload) parts.push(`Carga ${turnContext.workload}`);
  if (turnContext.shiftPhase) parts.push(`franja ${turnContext.shiftPhase}`);
  if (turnContext.operationalSummary) parts.push(turnContext.operationalSummary);

  const incidents = (turnContext.serviceIncidents ?? [])
    .map((incident) => incident.description?.trim())
    .filter(isNonEmptyString);
  if (incidents.length > 0) {
    parts.push(`Incidencias de servicio: ${incidents.join(', ')}`);
  }

  return parts.length > 0 ? parts.join('. ') : undefined;
}

function describePendingTasks(tasks?: PendingTask[]): string | undefined {
  const actionable = (tasks ?? [])
    .filter((task) => task.status !== 'done')
    .slice(0, 3)
    .map((task) => {
      const extras = [task.priority, task.dueBy].filter(isNonEmptyString).join(' / ');
      return extras ? `${task.title} (${extras})` : task.title;
    });

  return actionable.length > 0 ? `Pendientes: ${actionable.join(', ')}` : undefined;
}

function describeContingencyPlan(plan?: ContingencyPlan): string | undefined {
  if (!plan) return undefined;

  const parts: string[] = [];
  if ((plan.watchItems ?? []).length > 0) {
    parts.push(`Vigilar ${plan.watchItems?.join(', ')}`);
  }
  if ((plan.immediateActions ?? []).length > 0) {
    parts.push(`Acciones inmediatas: ${plan.immediateActions?.join(', ')}`);
  }
  if ((plan.escalationCriteria ?? []).length > 0) {
    parts.push(`Escalar si ${plan.escalationCriteria?.join(', ')}`);
  }
  if (plan.escalationContact) {
    parts.push(`Avisar a ${plan.escalationContact}`);
  }
  if (plan.fallbackPlan?.trim()) {
    parts.push(`Plan alternativo: ${plan.fallbackPlan.trim()}`);
  }

  return parts.length > 0 ? parts.join('. ') : undefined;
}
function bestNursingDx(h: HandoverFormData): string | undefined {
  const nanda = h.dxNursingStructured?.find((d) => d?.system === 'NANDA' && d.display)?.display?.trim();
  if (nanda) return nanda;
  return getDxNursingText(h.dxNursing);
}

function buildSituation(data: HandoverFormData): string {
  const diagnosis =
    getDxMedicalDisplay(data.dxMedical) ??
    bestNursingDx(data) ??
    data.dxMedicalStructured?.[0]?.display?.trim() ??
    data.dxNursingStructured?.[0]?.display?.trim();

  const admission = diagnosis ? `Paciente con ${diagnosis}` : 'Paciente con información parcial disponible';
  const location = data.administrativeData?.unit ? `Ubicación: ${data.administrativeData.unit}` : undefined;

  const vitals = data.vitals;
  const news2 = vitals
    ? computeNEWS2({
        rr: vitals.rr,
        spo2: vitals.spo2,
        temp: vitals.tempC,
        sbp: vitals.sbp,
        hr: vitals.hr,
        o2: isSupplementalOxygen((data as any).oxygenTherapy),
        avpu: vitals.avpu,
        scale2: false,
      })
    : undefined;

  const newsText = news2 ? `NEWS2 ${news2.total} (${NEWS2_BAND_LABEL[news2.band]} riesgo)` : undefined;
  const oxygen = formatOxygenTherapy((data as any).oxygenTherapy);
  const evolution = data.evolution ? `Evolución: ${data.evolution}` : undefined;
  const turnContext = describeTurnContext(data.turnContext);

  const situation = joinSentences([admission, location, newsText, oxygen, evolution, turnContext]);
  return situation || 'Paciente con información parcial disponible. Revisar historia clínica y registro de enfermería.';
}

function buildBackground(data: HandoverFormData): string {
  const antecedentes: string[] = [];

  const medical = getDxMedicalDisplay(data.dxMedical);
  const nursing = bestNursingDx(data);

  if (medical && nursing) antecedentes.push(`Cuadro mixto: ${medical}; ${nursing}`);

  const diet = (data as any).nutrition?.dietType ? `Dieta ${(data as any).nutrition.dietType}` : undefined;
  const mobility = describeMobility((data as any).mobility?.mobilityLevel, (data as any).mobility?.repositioningPlan);
  const skin = (data as any).skin?.skinStatus ? `Piel: ${(data as any).skin.skinStatus}` : undefined;
  const allergies = (data as any).bedsideChecklist?.allergiesReviewed ? 'Alergias revisadas' : undefined;
  const bedsideNotes = (data as any).bedsideChecklist?.bedsideNotes;

  const contingency = describeContingencyPlan(data.contingencyPlan);

  antecedentes.push(...[diet, mobility, skin, allergies, bedsideNotes, contingency].filter(isNonEmptyString));

  const background = antecedentes.join('. ');
  return background || 'Antecedentes relevantes recogidos en la historia clínica, revisar para más detalles.';
}

function buildAssessment(data: HandoverFormData): string {
  const vitals = data.vitals;
  const news2 = vitals
    ? computeNEWS2({
        rr: vitals.rr,
        spo2: vitals.spo2,
        temp: vitals.tempC,
        sbp: vitals.sbp,
        hr: vitals.hr,
        o2: isSupplementalOxygen((data as any).oxygenTherapy),
        avpu: vitals.avpu,
        scale2: false,
      })
    : undefined;

  const parts: string[] = [];
  if (news2) parts.push(`NEWS2 ${news2.total} (${NEWS2_BAND_LABEL[news2.band]} riesgo)`);

  const oxygen = formatOxygenTherapy((data as any).oxygenTherapy);
  if (oxygen) parts.push(oxygen);

  const risks = describeRisks((data as any).risks, (data as any).risksStructured);
  if (risks) parts.push(risks);

  const pendingTasks = describePendingTasks(data.pendingTasks);
  if (pendingTasks) parts.push(pendingTasks);

  const pain = describePain((data as any).painAssessment);
  if (pain) parts.push(pain);

  const balance = describeFluidBalance((data as any).fluidBalance);
  if (balance) parts.push(balance);

  const braden = data.braden
    ? `Braden ${data.braden.totalScore} (${BRADEN_LABELS[data.braden.riskLevel]} riesgo)`
    : undefined;
  if (braden) parts.push(braden);

  const glasgow = (data as any).glasgow ? `Glasgow ${(data as any).glasgow.total} (${(data as any).glasgow.severity})` : undefined;
  if (glasgow) parts.push(glasgow);

  const assessment = parts.join('. ');
  return assessment || 'Paciente sin hallazgos críticos reportados. Mantener vigilancia estándar.';
}

function buildRecommendation(data: HandoverFormData): string {
  const tasks: string[] = [];
  if (data.meds) tasks.push(`Medicaciones pendientes: ${data.meds}`);
  if ((data as any).treatments?.length) tasks.push('Procedimientos/curas programadas revisar hoja de tratamientos');
  if ((data as any).painAssessment?.hasPain) tasks.push('Control del dolor según plan');

  if (((data as any).risks && Object.values((data as any).risks).some(Boolean)) || (data as any).risksStructured?.length) {
    const risks = describeRisks((data as any).risks, (data as any).risksStructured);
    if (risks) tasks.push(`Vigilar ${risks.replace('Riesgos: ', '')}`);
  }

  if ((data as any).fluidBalance?.notes) tasks.push(`Balance/diuresis: ${(data as any).fluidBalance.notes}`);
  if (data.evolution) tasks.push(`Seguir plan: ${data.evolution}`);

  const pendingTasks = describePendingTasks(data.pendingTasks);
  if (pendingTasks) tasks.push(pendingTasks);

  const contingency = describeContingencyPlan(data.contingencyPlan);
  if (contingency) tasks.push(contingency);

  if (!tasks.length) tasks.push('Control de signos vitales cada 4-6 h y revisar diuresis si aplica');
  return tasks.join('. ');
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

export function formatSbar(summary: SBARSummary, locale: 'es' | 'en' = 'es'): string {
  const labels =
    locale === 'en'
      ? { situation: 'S: Situation', background: 'B: Background', assessment: 'A: Assessment', recommendation: 'R: Recommendation' }
      : { situation: 'S: Situación', background: 'B: Antecedentes', assessment: 'A: Valoración', recommendation: 'R: Recomendación' };

  return [
    `${labels.situation}: ${summary.situation}`,
    `${labels.background}: ${summary.background}`,
    `${labels.assessment}: ${summary.assessment}`,
    `${labels.recommendation}: ${summary.recommendation}`,
  ].join('\n');
}

export function generateSbarText(data: HandoverFormData, options: SbarOptions = {}): string {
  const summary = generateSbarSummary(data, options);
  return formatSbar(summary, options.locale ?? 'es');
}




