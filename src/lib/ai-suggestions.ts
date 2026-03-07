import { AI_BACKEND_BASE_URL } from '@/src/config/env';

export interface NocOutcomeSuggestion {
  nocCode: string;
  nocDisplay: string;
  baseline: number;
  target: number;
  current?: number;
}

export interface ClinicalContext {
  language: 'es' | 'en';
  section: 'vitals' | 'diagnosis' | 'risk' | 'other' | 'outcomes';
  patientAge?: number;
  vitalSigns?: {
    respiratoryRate?: number;
    heartRate?: number;
    systolicBP?: number;
    spo2?: number;
    temperature?: number;
    consciousness?: string;
    onOxygen?: boolean;
  };
  scores?: {
    news2?: number;
    braden?: number;
    [key: string]: number | undefined;
  };
  diagnoses?: string[];
  devices?: string[];
  notes?: string;
}

export interface SuggestionsResult {
  section: ClinicalContext['section'];
  interventions: string[];
  outcomes?: NocOutcomeSuggestion[];
  rationale?: string;
}

interface SuggestionsBackendResponse {
  interventions?: unknown;
  outcomes?: unknown;
  rationale?: unknown;
  section?: unknown;
}

const asBoundedScore = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return undefined;
  return rounded;
};

const parseOutcomes = (raw: unknown): NocOutcomeSuggestion[] => {
  if (!Array.isArray(raw)) return [];

  const outcomes: NocOutcomeSuggestion[] = [];

  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    const record = item as Record<string, unknown>;
    const nocCode = typeof record.nocCode === 'string' ? record.nocCode.trim() : '';
    const nocDisplay = typeof record.nocDisplay === 'string' ? record.nocDisplay.trim() : '';
    const baseline = asBoundedScore(record.baseline);
    const target = asBoundedScore(record.target);
    const current = asBoundedScore(record.current);

    if (!nocCode || !nocDisplay || baseline == null || target == null) return;

    outcomes.push({
      nocCode,
      nocDisplay,
      baseline,
      target,
      ...(current != null ? { current } : {}),
    });
  });

  return outcomes;
};

export async function fetchInterventionsSuggestions(
  ctx: ClinicalContext,
): Promise<SuggestionsResult> {
  if (!AI_BACKEND_BASE_URL) {
    throw new Error('Módulo de IA no configurado');
  }

  const response = await fetch(`${AI_BACKEND_BASE_URL}/ai/suggest-interventions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ctx),
  });

  if (!response.ok) {
    throw new Error('No se pudieron obtener sugerencias de intervenciones');
  }

  const data = (await response.json()) as SuggestionsBackendResponse;
  const interventions =
    Array.isArray(data?.interventions) && data.interventions.every((item) => typeof item === 'string')
      ? data.interventions
      : undefined;
  const outcomes = parseOutcomes(data?.outcomes);

  if (!data || typeof data.section !== 'string' || (!interventions && outcomes.length === 0)) {
    throw new Error('Respuesta de IA no válida');
  }

  const fallbackInterventions = outcomes.map((item) => `NOC ${item.nocCode}: ${item.nocDisplay}`);
  const rationale = typeof data.rationale === 'string' ? data.rationale : undefined;

  return {
    section: data.section as ClinicalContext['section'],
    interventions: interventions ?? fallbackInterventions,
    outcomes: outcomes.length > 0 ? outcomes : undefined,
    rationale,
  };
}

