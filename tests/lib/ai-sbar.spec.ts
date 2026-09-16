import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

const envState = {
  AI_BACKEND_BASE_URL: 'https://ai.example',
  AI_SBAR_ENABLED: true,
  FHIR_BASE_URL: 'http://fhir.example',
  API_BASE: '',
};

vi.mock('@/src/config/env', () => ({
  get AI_BACKEND_BASE_URL() {
    return envState.AI_BACKEND_BASE_URL;
  },
  get AI_SBAR_ENABLED() {
    return envState.AI_SBAR_ENABLED;
  },
  get FHIR_BASE_URL() {
    return envState.FHIR_BASE_URL;
  },
  get API_BASE() {
    return envState.API_BASE;
  },
  ENV: envState,
}));

const ensureFreshAccessToken = vi.fn(async () => 'tok-ai-123');
vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken,
}));

const handover: HandoverFormData = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    shiftType: 'Manana',
    incidents: [],
  },
  status: 'draft',
  patientId: 'P-10',
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonia' },
  dxNursing: { system: SNOMED_SYSTEM, code: '422587007', display: 'Disnea' },
  dxMedicalStructured: [],
  dxNursingStructured: [],
  evolution: 'Estable',
  closingSummary: '',
  medications: [],
  treatments: [],
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  risksStructured: [],
};

const draft: SBARSummary = {
  situation: 'S',
  background: 'B',
  assessment: 'A',
  recommendation: 'R',
};

describe('refineSBARWithAI', () => {
  beforeEach(() => {
    vi.resetModules();
    envState.AI_BACKEND_BASE_URL = 'https://ai.example';
    envState.AI_SBAR_ENABLED = true;
    ensureFreshAccessToken.mockResolvedValue('tok-ai-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('devuelve null cuando la configuracion de IA no esta disponible', async () => {
    envState.AI_BACKEND_BASE_URL = null as unknown as string;
    envState.AI_SBAR_ENABLED = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { refineSBARWithAI } = await import('@/src/lib/ai-sbar');

    const result = await refineSBARWithAI(handover, draft);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa el backend Django autenticado para refinar SBAR', async () => {
    const refined: SBARSummary = {
      situation: 'IA situation',
      background: 'IA background',
      assessment: 'IA assessment',
      recommendation: 'IA recommendation',
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ sbar: refined }) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { refineSBARWithAI } = await import('@/src/lib/ai-sbar');

    const result = await refineSBARWithAI(handover, draft);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ai.example/ai/refine-sbar',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-ai-123',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toEqual(refined);
  });

  it('captura errores del backend y devuelve null', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { refineSBARWithAI } = await import('@/src/lib/ai-sbar');

    const result = await refineSBARWithAI(handover, draft);

    expect(result).toBeNull();
  });
});

describe('result helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    envState.AI_BACKEND_BASE_URL = 'https://ai.example';
    envState.AI_SBAR_ENABLED = true;
    ensureFreshAccessToken.mockResolvedValue('tok-ai-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(['dxMedical', 'dxNursing', 'device'] as const)(
    'acepta el límite del DTO de %s en generate y refine sin modificar el formulario',
    async (field) => {
      const limit = field === 'device' ? 80 : 240;
      const value = 'x'.repeat(limit);
      const clinicalData: HandoverFormData = {
        ...handover,
        dxMedical: field === 'dxMedical' ? { ...handover.dxMedical!, display: value } : handover.dxMedical,
        dxNursing: field === 'dxNursing' ? value : handover.dxNursing,
        oxygenTherapy: { device: field === 'device' ? value : 'cánula' },
      };
      const original = JSON.stringify(clinicalData);
      const fetchMock = vi.fn(async (url: string, _options: RequestInit) => ({
        ok: true,
        json: async () => url.endsWith('refine-sbar')
          ? { sbar: draft }
          : { ...draft, full_text: 'SBAR' },
      }));
      vi.stubGlobal('fetch', fetchMock);
      const { buildExternalAiClinicalContext, generateSbarViaBackendResult, refineSBARWithAIResult } = await import('@/src/lib/ai-sbar');
      const context = buildExternalAiClinicalContext(clinicalData);

      expect((await generateSbarViaBackendResult('nota breve', context)).ok).toBe(true);
      expect((await refineSBARWithAIResult(clinicalData, draft)).ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).context).toEqual(context);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).handover).toEqual(context);
      expect(JSON.stringify(clinicalData)).toBe(original);
    },
  );

  it.each(['dxMedical', 'dxNursing', 'device'] as const)(
    'bloquea %s demasiado largo localmente en generate y refine sin reflejar PHI',
    async (field) => {
      const marker = 'PHI-EXTERNAL-DTO';
      const value = marker + 'x'.repeat((field === 'device' ? 80 : 240) - marker.length + 1);
      const clinicalData: HandoverFormData = {
        ...handover,
        dxMedical: field === 'dxMedical' ? { ...handover.dxMedical!, display: value } : handover.dxMedical,
        dxNursing: field === 'dxNursing' ? value : handover.dxNursing,
        oxygenTherapy: { device: field === 'device' ? value : 'cánula' },
      };
      const original = JSON.stringify(clinicalData);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { buildExternalAiClinicalContext, generateSbarViaBackendResult, refineSBARWithAIResult } = await import('@/src/lib/ai-sbar');

      const generated = await generateSbarViaBackendResult('nota breve', buildExternalAiClinicalContext(clinicalData));
      const refined = await refineSBARWithAIResult(clinicalData, draft);

      for (const result of [generated, refined]) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('INVALID_INPUT');
          expect(result.error.message).not.toContain(marker);
        }
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(JSON.stringify(clinicalData)).toBe(original);
    },
  );

  it('bloquea free_text, draft y contexto estructurado inválidos antes de HTTP', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { generateSbarViaBackendResult, refineSBARWithAIResult } = await import('@/src/lib/ai-sbar');
    const marker = 'PHI-OVER-LIMIT';
    const oversized = marker + 'x'.repeat(15001 - marker.length);
    const invalidRequests = [
      await generateSbarViaBackendResult(oversized, {}),
      await generateSbarViaBackendResult('nota', { vitals: { hr: 500 } }),
      await generateSbarViaBackendResult('nota', { unknown: marker }),
      await refineSBARWithAIResult(handover, { ...draft, situation: oversized }),
    ];

    for (const result of invalidRequests) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_INPUT');
        expect(result.error.message).not.toContain(marker);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clasifica 401 como no autorizado para degradacion honesta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: 'unauthorized' }) })) as unknown as typeof fetch,
    );

    const { generateSbarViaBackendResult } = await import('@/src/lib/ai-sbar');

    const result = await generateSbarViaBackendResult('nota breve', { vitals: { hr: 80 } }, 'es');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.status).toBe(401);
    }
  });

  it('clasifica 5xx como backend no disponible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) })) as unknown as typeof fetch,
    );

    const { generateSbarViaBackendResult } = await import('@/src/lib/ai-sbar');

    const result = await generateSbarViaBackendResult('nota breve', { vitals: { hr: 80 } }, 'es');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAVAILABLE');
      expect(result.error.status).toBe(503);
    }
  });

  it('expone exito estructurado para refine sin perder el wrapper legacy', async () => {
    const refined: SBARSummary = {
      situation: 'IA situation',
      background: 'IA background',
      assessment: 'IA assessment',
      recommendation: 'IA recommendation',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ sbar: refined }) })) as unknown as typeof fetch,
    );

    const { refineSBARWithAIResult } = await import('@/src/lib/ai-sbar');

    const result = await refineSBARWithAIResult(handover, draft);

    expect(result).toEqual({ ok: true, summary: refined });
  });
});
