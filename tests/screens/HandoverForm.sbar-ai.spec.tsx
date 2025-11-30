import React from 'react';
import { create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoverFormData } from '@/src/validation/schemas';

const envState = {
  AI_SBAR_BASE_URL: 'https://ai-sbar.example',
  AI_SBAR_ENABLED: true,
  AI_SBAR_API_KEY: 'token',
  AI_BACKEND_BASE_URL: 'https://ai.example',
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
  get AI_SBAR_ENABLED() {
    return envState.AI_SBAR_ENABLED;
  },
  get AI_SBAR_API_KEY() {
    return envState.AI_SBAR_API_KEY;
  },
  get AI_BACKEND_BASE_URL() {
    return envState.AI_BACKEND_BASE_URL;
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

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    ...actual,
    FormProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Controller: ({ render }: { render: ({ field }: { field: any }) => React.ReactNode }) =>
      render({ field: { onChange: vi.fn(), onBlur: vi.fn(), value: '' } }),
    useFieldArray: () => ({ fields: [], append: vi.fn(), remove: vi.fn() }),
  };
});

const mockUseZodForm = vi.fn();
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

const refineSBARWithAI = vi.fn();
vi.mock('@/src/lib/ai-sbar', () => ({
  refineSBARWithAI,
}));

vi.mock('@/src/lib/stt', () => ({
  createSttService: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    addListener: vi.fn(() => vi.fn()),
    getStatus: () => 'idle',
    getLastError: () => null,
  }),
}));

vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/TreatmentsSection', () => ({ default: () => null }));
vi.mock('@/src/config/flags', () => ({ isOn: () => true }));
vi.mock('@/src/security/auth', () => ({ getSession: vi.fn(async () => null) }));
vi.mock('@/src/security/acl', () => ({ currentUser: () => null, hasUnitAccess: () => true }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: vi.fn() }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn(async () => undefined) }));

const baseValues: HandoverFormData = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    incidents: [],
  },
  status: 'draft',
  patientId: 'P-10',
  dxMedical: 'Neumonía',
  dxNursing: 'Riesgo respiratorio',
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
  const navigation: any = { navigate: vi.fn(), getState: vi.fn(() => ({ routeNames: [] })), goBack: vi.fn() };
  const route: any = { key: 'test', name: 'HandoverForm', params: {} };
  const trigger = vi.fn(async () => true);
  const setValue = vi.fn();
  let currentValues: HandoverFormData;

  beforeEach(() => {
    vi.resetModules();
    envState.AI_SBAR_BASE_URL = 'https://ai-sbar.example';
    envState.AI_SBAR_ENABLED = true;
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refina la SBAR con IA y actualiza todos los campos', async () => {
    const refined = {
      situation: 'IA situation',
      background: 'IA background',
      assessment: 'IA assessment',
      recommendation: 'IA recommendation',
    };
    refineSBARWithAI.mockResolvedValueOnce(refined);

    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');

    let renderer: ReturnType<typeof create> | undefined;
    await vi.act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    const buttons = renderer!.root.findAllByType(require('react-native').Button);
    const refineButton = buttons.find((btn) => btn.props.title === 'Refinar SBAR con IA');
    expect(refineButton).toBeDefined();

    await vi.act(async () => {
      await refineButton!.props.onPress();
    });

    expect(refineSBARWithAI).toHaveBeenCalledWith(currentValues, {
      situation: 'draft situation',
      background: 'draft background',
      assessment: 'draft assessment',
      recommendation: 'draft recommendation',
    });
    expect(setValue).toHaveBeenCalledWith(
      'sbarSituation',
      'IA situation',
      expect.objectContaining({ shouldDirty: true, shouldValidate: true }),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarBackground',
      'IA background',
      expect.objectContaining({ shouldDirty: true, shouldValidate: true }),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarAssessment',
      'IA assessment',
      expect.objectContaining({ shouldDirty: true, shouldValidate: true }),
    );
    expect(setValue).toHaveBeenCalledWith(
      'sbarRecommendation',
      'IA recommendation',
      expect.objectContaining({ shouldDirty: true, shouldValidate: true }),
    );
  });

  it('mantiene el draft cuando la IA devuelve null y muestra error', async () => {
    refineSBARWithAI.mockResolvedValueOnce(null);
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');

    let renderer: ReturnType<typeof create> | undefined;
    await vi.act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    const refineButton = renderer!.root
      .findAllByType(require('react-native').Button)
      .find((btn) => btn.props.title === 'Refinar SBAR con IA');

    await vi.act(async () => {
      await refineButton!.props.onPress();
    });

    expect(setValue).not.toHaveBeenCalled();
    const errorText = renderer!.root
      .findAllByType(require('react-native').Text)
      .find((node) =>
        typeof node.props.children === 'string' &&
        node.props.children.includes('No se pudo contactar con la IA'),
      );
    expect(errorText).toBeDefined();
  });

  it('deshabilita el botón IA cuando no está disponible y permite generar SBAR local', async () => {
    envState.AI_SBAR_ENABLED = false;
    envState.AI_SBAR_BASE_URL = null as unknown as string;
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');

    let renderer: ReturnType<typeof create> | undefined;
    await vi.act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    const buttons = renderer!.root.findAllByType(require('react-native').Button);
    const refineButton = buttons.find((btn) => btn.props.title === 'IA no disponible');
    expect(refineButton?.props.disabled).toBe(true);

    const generateButton = buttons.find((btn) => btn.props.title === 'Generar SBAR sugerida');
    expect(generateButton).toBeDefined();

    await vi.act(async () => {
      await generateButton!.props.onPress();
    });

    expect(setValue).toHaveBeenCalledTimes(4);
  });
});
