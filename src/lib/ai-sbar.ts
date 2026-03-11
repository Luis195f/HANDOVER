import { AI_BACKEND_BASE_URL } from '@/src/config/env';
import { ensureFreshAccessToken } from '@/src/security/auth';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

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

interface RefineSbarResponse {
  sbar?: Partial<SBARSummary> | null;
}

const LEGAL_NOTICE_BY_LANG: Record<'es' | 'en', string> = {
  es: 'Aviso legal: Asistente de apoyo, no diagnóstico ni prescripción.',
  en: 'Legal notice: Support assistant, not a diagnosis or prescription.',
};

const formatSbarText = (
  summary: Pick<SbarResult, 'situation' | 'background' | 'assessment' | 'recommendation'>,
  language: 'es' | 'en',
) => {
  const labels =
    language === 'en'
      ? { situation: 'S: Situation', background: 'B: Background', assessment: 'A: Assessment', recommendation: 'R: Recommendation' }
      : { situation: 'S: Situación', background: 'B: Antecedentes', assessment: 'A: Valoración', recommendation: 'R: Recomendación' };

  return [
    `${labels.situation}: ${summary.situation}`,
    `${labels.background}: ${summary.background}`,
    `${labels.assessment}: ${summary.assessment}`,
    `${labels.recommendation}: ${summary.recommendation}`,
  ].join('\n');
};

const appendLegalNotice = (text: string, language: 'es' | 'en') => {
  const notice = LEGAL_NOTICE_BY_LANG[language];
  const trimmed = text.trim();
  if (!trimmed) return notice;
  return `${trimmed}\n\n${notice}`;
};

function getAiBackendBaseUrl(): string | null {
  const baseUrl = typeof AI_BACKEND_BASE_URL === 'string' && AI_BACKEND_BASE_URL.trim() ? AI_BACKEND_BASE_URL.trim() : null;
  if (!baseUrl) {
    console.info('[ai-sbar] AI backend is not configured');
  }
  return baseUrl;
}

async function buildJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = await ensureFreshAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function toSafeString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return fallback;
}

function buildRefinedSbar(candidate: Partial<SBARSummary> | null | undefined, draft: SBARSummary): SBARSummary {
  if (!candidate || typeof candidate !== 'object') return { ...draft };
  return {
    situation: toSafeString(candidate.situation, draft.situation),
    background: toSafeString(candidate.background, draft.background),
    assessment: toSafeString(candidate.assessment, draft.assessment),
    recommendation: toSafeString(candidate.recommendation, draft.recommendation),
  };
}

const legacyDxNursingText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const r = value as Record<string, unknown>;
    const display = typeof r.display === 'string' ? r.display.trim() : '';
    const code = typeof r.code === 'string' ? r.code.trim() : '';
    return display || code || '';
  }
  return '';
};

export async function refineSBARWithAI(handover: HandoverFormData, draft: SBARSummary): Promise<SBARSummary | null> {
  const baseUrl = getAiBackendBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const payload = {
    handover: {
      dxMedical: handover.dxMedical?.display ?? '',
      dxNursing: legacyDxNursingText(handover.dxNursing),
      vitals: handover.vitals,
      oxygenTherapy: handover.oxygenTherapy,
      risks: (handover as Record<string, unknown>).risks,
      evolution: handover.evolution,
      mobility: (handover as Record<string, unknown>).mobility,
      nutrition: (handover as Record<string, unknown>).nutrition,
    },
    draft: { ...draft },
    language: 'es' as const,
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 15000) : null;

  try {
    const response = await fetch(`${baseUrl}/ai/refine-sbar`, {
      method: 'POST',
      headers: await buildJsonHeaders(),
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as RefineSbarResponse;
    return buildRefinedSbar(data?.sbar, draft);
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function generateSbarViaBackend(
  freeText: string,
  context?: Record<string, unknown>,
  language: 'es' | 'en' = 'es',
): Promise<SbarResult> {
  const trimmed = freeText.trim();
  if (!trimmed) throw new Error('No se pudo generar el SBAR con IA');

  const baseUrl = getAiBackendBaseUrl();
  if (!baseUrl) throw new Error('Módulo de IA no configurado');

  const response = await fetch(`${baseUrl}/ai/summarize-sbar`, {
    method: 'POST',
    headers: await buildJsonHeaders(),
    body: JSON.stringify({ free_text: trimmed, context, language }),
  });

  if (!response.ok) throw new Error('No se pudo generar el SBAR con IA');

  const data = (await response.json()) as SbarBackendResponse;

  if (
    typeof data.situation !== 'string' ||
    typeof data.background !== 'string' ||
    typeof data.assessment !== 'string' ||
    typeof data.recommendation !== 'string'
  ) {
    throw new Error('No se pudo generar el SBAR con IA');
  }

  const rawText = typeof data.full_text === 'string' ? data.full_text : '';
  const baseText = rawText.trim()
    ? rawText
    : formatSbarText(
        { situation: data.situation, background: data.background, assessment: data.assessment, recommendation: data.recommendation },
        language,
      );

  const fullText = appendLegalNotice(baseText, language);

  return {
    situation: data.situation,
    background: data.background,
    assessment: data.assessment,
    recommendation: data.recommendation,
    fullText,
  };
}
