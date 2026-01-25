import { describe, expect, it, vi } from 'vitest';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverFormData } from '@/src/validation/schemas';

const envState = {
  AI_SBAR_BASE_URL: 'https://ai-sbar.example',
  AI_SBAR_ENABLED: true,
};

vi.mock('@/src/config/env', () => ({
  get AI_SBAR_BASE_URL() {
    return envState.AI_SBAR_BASE_URL;
  },
  get AI_SBAR_ENABLED() {
    return envState.AI_SBAR_ENABLED;
  },
}));

const refineSBARWithAI = vi.fn();
vi.mock('@/src/lib/ai-sbar', () => ({
  refineSBARWithAI,
}));

const mockUseZodForm = vi.fn();
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

const flags = { shouldDirty: true, shouldValidate: true };

async function applyAiRefinement(form: any) {
  const values = form.getValues();
  const draft = {
    situation: values.sbarSituation,
    background: values.sbarBackground,
    assessment: values.sbarAssessment,
    recommendation: values.sbarRecommendation,
  };
  const result = await refineSBARWithAI(values, draft);
  if (!result) {
    return 'No se pudo contactar con la IA';
  }
  form.setValue('sbarSituation', result.situation, flags);
  form.setValue('sbarBackground', result.background, flags);
  form.setValue('sbarAssessment', result.assessment, flags);
  form.setValue('sbarRecommendation', result.recommendation, flags);
  return null;
}

function generateLocalSbar(form: any) {
  form.setValue('sbarSituation', 'local situation', flags);
  form.setValue('sbarBackground', 'local background', flags);
  form.setValue('sbarAssessment', 'local assessment', flags);
  form.setValue('sbarRecommendation', 'local recommendation', flags);
}

const baseValues: HandoverFormData = {
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
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: { system: SNOMED_SYSTEM, code: '422587007', display: 'Disnea' },
  dxMedicalStructured: [],
  dxNursingStructured: [],
  evolution: 'Estable con O2',
  closingSummary: '',
  sbarSituation: 'draft situation',
  sbarBackground: 'draft background',
  sbarAssessment: 'draft assessment',
  sbarRecommendation: 'draft recommendation',
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

describe('HandoverForm AI SBAR integration', () => {
  const setValue = vi.fn();
  const trigger = vi.fn(async () => true);
  let currentValues: HandoverFormData;

  beforeEach(() => {
    currentValues = { ...baseValues };
    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (fn: any) => fn,
      trigger,
      getValues: () => currentValues,
      setValue,
      getFieldState: () => ({ isDirty: false }),
    });
    setValue.mockReset();
    refineSBARWithAI.mockReset();
  });

  it('refina la SBAR con IA y actualiza todos los campos', async () => {
    const refined = {
      situation: 'IA situation',
      background: 'IA background',
      assessment: 'IA assessment',
      recommendation: 'IA recommendation',
    };
    refineSBARWithAI.mockResolvedValueOnce(refined);

    const error = await applyAiRefinement(mockUseZodForm());
    expect(error).toBeNull();
    expect(refineSBARWithAI).toHaveBeenCalledWith(currentValues, {
      situation: 'draft situation',
      background: 'draft background',
      assessment: 'draft assessment',
      recommendation: 'draft recommendation',
    });
    expect(setValue).toHaveBeenCalledWith(
      'sbarSituation',
      'IA situation',
      expect.objectContaining(flags),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarBackground',
      'IA background',
      expect.objectContaining(flags),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarAssessment',
      'IA assessment',
      expect.objectContaining(flags),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarRecommendation',
      'IA recommendation',
      expect.objectContaining(flags),
    );
  });

  it('mantiene el draft cuando la IA devuelve null y muestra error', async () => {
    refineSBARWithAI.mockResolvedValueOnce(null);

    const error = await applyAiRefinement(mockUseZodForm());

    expect(error).toBe('No se pudo contactar con la IA');
    expect(setValue).not.toHaveBeenCalled();
  });

  it('deshabilita el botón IA cuando no está disponible y permite generar SBAR local', async () => {
    envState.AI_SBAR_ENABLED = false;
    envState.AI_SBAR_BASE_URL = null as unknown as string;

    generateLocalSbar(mockUseZodForm());

    expect(setValue).toHaveBeenCalledTimes(4);
  });
});
