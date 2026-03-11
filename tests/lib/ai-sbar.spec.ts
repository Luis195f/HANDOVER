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
