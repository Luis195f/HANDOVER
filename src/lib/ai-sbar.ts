import { AI_BACKEND_BASE_URL } from '@/src/config/env';

export interface SbarResult {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  fullText: string;
}

interface SbarBackendResponse {
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
  full_text?: string;
}

export async function generateSbarViaBackend(
  freeText: string,
  context?: Record<string, unknown>,
  language: 'es' | 'en' = 'es',
): Promise<SbarResult> {
  const trimmed = freeText.trim();
  if (!trimmed) {
    throw new Error('No se pudo generar el SBAR con IA');
  }

  if (!AI_BACKEND_BASE_URL) {
    throw new Error('Módulo de IA no configurado');
  }

  const response = await fetch(`${AI_BACKEND_BASE_URL}/ai/summarize-sbar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ free_text: trimmed, context, language }),
  });

  if (!response.ok) {
    throw new Error('No se pudo generar el SBAR con IA');
  }

  const data = (await response.json()) as SbarBackendResponse;
  if (
    typeof data.situation !== 'string' ||
    typeof data.background !== 'string' ||
    typeof data.assessment !== 'string' ||
    typeof data.recommendation !== 'string'
  ) {
    throw new Error('No se pudo generar el SBAR con IA');
  }

  const fullText = typeof data.full_text === 'string' ? data.full_text : '';

  return {
    situation: data.situation,
    background: data.background,
    assessment: data.assessment,
    recommendation: data.recommendation,
    fullText,
  };
}
