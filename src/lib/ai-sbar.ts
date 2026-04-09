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

export type AISbarErrorCode =
  | 'UNCONFIGURED'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export class AISbarError extends Error {
  code: AISbarErrorCode;
  status?: number;

  constructor(code: AISbarErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AISbarError';
    this.code = code;
    this.status = status;
  }
}

export type GenerateSbarViaBackendResult =
  | { ok: true; result: SbarResult }
  | { ok: false; error: AISbarError };

export type RefineSbarWithAiResult =
  | { ok: true; summary: SBARSummary }
  | { ok: false; error: AISbarError };

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

function toAISbarError(error: unknown): AISbarError {
  if (error instanceof AISbarError) return error;
  if (error instanceof TypeError || (error instanceof Error && /network|fetch/i.test(error.message))) {
    return new AISbarError('NETWORK', 'No se pudo contactar con el backend de IA');
  }
  return new AISbarError('UNKNOWN', 'No se pudo completar la solicitud SBAR');
}

async function resolveBackendError(response: Response): Promise<AISbarError> {
  const status = response.status;

  if (status === 401 || status === 403) {
    return new AISbarError('UNAUTHORIZED', 'La sesión no puede usar el backend de IA', status);
  }

  if (status >= 500) {
    return new AISbarError('UNAVAILABLE', 'El backend de IA no está disponible', status);
  }

  return new AISbarError('INVALID_RESPONSE', 'El backend de IA devolvió una respuesta inválida', status);
}

export async function refineSBARWithAIResult(
  handover: HandoverFormData,
  draft: SBARSummary,
): Promise<RefineSbarWithAiResult> {
  const baseUrl = getAiBackendBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      error: new AISbarError('UNCONFIGURED', 'El backend de IA no está configurado'),
    };
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

    if (!response.ok) {
      return { ok: false, error: await resolveBackendError(response) };
    }

    const data = (await response.json()) as RefineSbarResponse;
    return { ok: true, summary: buildRefinedSbar(data?.sbar, draft) };
  } catch (error) {
    return { ok: false, error: toAISbarError(error) };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function refineSBARWithAI(handover: HandoverFormData, draft: SBARSummary): Promise<SBARSummary | null> {
  const result = await refineSBARWithAIResult(handover, draft);
  if (!result.ok) {
    return null;
  }
  return result.summary;
}

export async function generateSbarViaBackendResult(
  freeText: string,
  context?: Record<string, unknown>,
  language: 'es' | 'en' = 'es',
): Promise<GenerateSbarViaBackendResult> {
  const trimmed = freeText.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: new AISbarError('INVALID_RESPONSE', 'No hay texto suficiente para generar un SBAR'),
    };
  }

  const baseUrl = getAiBackendBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      error: new AISbarError('UNCONFIGURED', 'El backend de IA no está configurado'),
    };
  }

  try {
    const response = await fetch(`${baseUrl}/ai/summarize-sbar`, {
      method: 'POST',
      headers: await buildJsonHeaders(),
      body: JSON.stringify({ free_text: trimmed, context, language }),
    });

    if (!response.ok) {
      return { ok: false, error: await resolveBackendError(response) };
    }

    const data = (await response.json()) as SbarBackendResponse;

    if (
      typeof data.situation !== 'string' ||
      typeof data.background !== 'string' ||
      typeof data.assessment !== 'string' ||
      typeof data.recommendation !== 'string'
    ) {
      return {
        ok: false,
        error: new AISbarError('INVALID_RESPONSE', 'La respuesta del backend de IA no tiene el formato esperado'),
      };
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
      ok: true,
      result: {
        situation: data.situation,
        background: data.background,
        assessment: data.assessment,
        recommendation: data.recommendation,
        fullText,
      },
    };
  } catch (error) {
    return { ok: false, error: toAISbarError(error) };
  }
}

export async function generateSbarViaBackend(
  freeText: string,
  context?: Record<string, unknown>,
  language: 'es' | 'en' = 'es',
): Promise<SbarResult> {
  const result = await generateSbarViaBackendResult(freeText, context, language);
  if (!result.ok) {
    throw result.error;
  }
  return result.result;
}
