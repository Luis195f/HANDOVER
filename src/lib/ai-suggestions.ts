import { AI_BACKEND_BASE_URL } from '@/src/config/env';

export interface ClinicalContext {
  language: 'es' | 'en';
  section: 'vitals' | 'diagnosis' | 'risk' | 'other';
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
  rationale?: string;
}

interface SuggestionsBackendResponse {
  interventions?: unknown;
  rationale?: unknown;
  section?: unknown;
}

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
  if (
    !data ||
    typeof data.section !== 'string' ||
    !Array.isArray(data.interventions) ||
    !data.interventions.every((item) => typeof item === 'string')
  ) {
    throw new Error('Respuesta de IA no válida');
  }

  const rationale = typeof data.rationale === 'string' ? data.rationale : undefined;

  return {
    section: data.section as ClinicalContext['section'],
    interventions: data.interventions,
    rationale,
  };
}
