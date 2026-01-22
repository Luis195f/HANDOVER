import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

const envState = {
  AI_SBAR_BASE_URL: 'https://ai-sbar.example',
  AI_SBAR_API_KEY: 'token',
  AI_BACKEND_BASE_URL: 'https://ai.example',
  AI_SBAR_ENABLED: true,
  AI_BACKEND_ENABLED: true,
  STT_ENDPOINT: 'https://stt.example',
  FHIR_BASE_URL: 'http://fhir.example',
  API_BASE: '',
  API_TOKEN: '',
};

vi.mock('@/src/config/env', () => ({
  get AI_SBAR_BASE_URL() {
    return envState.AI_SBAR_BASE_URL;
  },
  get AI_SBAR_API_KEY() {
    return envState.AI_SBAR_API_KEY;
  },
  get AI_BACKEND_BASE_URL() {
    return envState.AI_BACKEND_BASE_URL;
  },
  get AI_SBAR_ENABLED() {
    return envState.AI_SBAR_ENABLED;
  },
  get AI_BACKEND_ENABLED() {
    return envState.AI_BACKEND_ENABLED;
  },
  get STT_ENDPOINT() {
    return envState.STT_ENDPOINT;
  },
  get FHIR_BASE_URL() {
    return envState.FHIR_BASE_URL;
  },
  get API_BASE() {
    return envState.API_BASE;
  },
  get API_TOKEN() {
    return envState.API_TOKEN;
  },
  ENV: envState,
}));

const handover: HandoverFormData = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  status: 'draft',
  patientId: 'P-10',
  dxMedical: 'Neumonía',
  dxNursing: 'Riesgo respiratorio',
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
    envState.AI_SBAR_BASE_URL = 'https://ai-sbar.example';
    envState.AI_SBAR_ENABLED = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('devuelve null cuando la configuración de IA SBAR no está disponible', async () => {
    envState.AI_SBAR_BASE_URL = null as unknown as string;
    envState.AI_SBAR_ENABLED = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { refineSBARWithAI } = await import('@/src/lib/ai-sbar');

    const result = await refineSBARWithAI(handover, draft);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retorna el SBAR refinado cuando el backend responde correctamente', async () => {
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
      'https://ai-sbar.example/api/sbar/refine',
      expect.objectContaining({ method: 'POST' }),
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
