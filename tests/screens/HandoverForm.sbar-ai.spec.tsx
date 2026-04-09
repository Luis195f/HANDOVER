import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { SbarSection } from '@/src/screens/handover/SbarSection';
import type { HandoverFormData } from '@/src/validation/schemas';

const flagState = vi.hoisted(() => ({
  values: { SHOW_SBAR: true } as Record<string, boolean>,
}));
const envState = vi.hoisted(() => ({
  AI_BACKEND_ENABLED: true,
  AI_SBAR_ENABLED: true,
}));
const pilotRuntimeState = vi.hoisted(() => ({
  pilotControlVersion: 0,
}));

const useSelectedUnitId = vi.fn(() => 'unit-1');
const mockUseZodForm = vi.fn();
const generateSbarViaBackendResult = vi.fn();
const refineSBARWithAIResult = vi.fn();
const logClinicalDecision = vi.fn(async () => undefined);

let HandoverForm: typeof import('@/src/screens/HandoverForm').default;

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  let currentContext: any;
  return {
    ...actual,
    Controller: ({ render, defaultValue }: any) =>
      render({
        field: { onChange: vi.fn(), onBlur: vi.fn(), value: defaultValue },
        fieldState: { error: undefined },
      }),
    FormProvider: ({ children, ...ctx }: any) => {
      currentContext = ctx;
      return <>{children}</>;
    },
    useFormContext: () => currentContext,
    useFieldArray: () => ({ fields: [], append: vi.fn(), remove: vi.fn() }),
    useController: ({ defaultValue }: { defaultValue?: unknown }) => ({
      field: {
        onChange: vi.fn(),
        onBlur: vi.fn(),
        value:
          defaultValue ?? {
            system: SNOMED_SYSTEM,
            code: '',
            display: '',
          },
      },
      fieldState: { error: undefined },
    }),
  };
});

vi.mock('@/src/config/flags', () => ({
  isOn: (name: string) => flagState.values[name] ?? false,
}));
vi.mock('@/src/config/env', () => ({
  API_BASE_URL: 'https://api.example',
  API_BASE: 'https://api.example',
  AI_TRANSCRIBE_ENDPOINT: 'https://api.example/api/ai/transcribe',
  AI_BACKEND_BASE_URL: 'https://api.example/api',
  FHIR_BASE_URL: 'https://fhir.example',
  get AI_BACKEND_ENABLED() {
    return envState.AI_BACKEND_ENABLED;
  },
  get AI_SBAR_ENABLED() {
    return envState.AI_SBAR_ENABLED;
  },
  ENV: {
    API_BASE: 'https://api.example',
    API_BASE_URL: 'https://api.example',
    AI_TRANSCRIBE_ENDPOINT: 'https://api.example/api/ai/transcribe',
    AI_BACKEND_BASE_URL: 'https://api.example/api',
    AI_BACKEND_ENABLED: true,
    AI_SBAR_ENABLED: true,
    FHIR_BASE_URL: 'https://fhir.example',
  },
}));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId, ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/config/pilotControl', () => ({
  isPilotFeatureEnabled: vi.fn(() => false),
  usePilotControlContext: vi.fn(() => pilotRuntimeState.pilotControlVersion),
}));
vi.mock('@/src/lib/profile-runtime', () => {
  const HANDOVER_SECTIONS_INFO = [
    { key: 'turno', title: 'Datos del turno' },
    { key: 'paciente', title: 'Paciente' },
    { key: 'sbar', title: 'SBAR' },
    { key: 'signos', title: 'Signos vitales' },
    { key: 'oxigenoterapia', title: 'Oxigenoterapia' },
    { key: 'dispositivos', title: 'Dispositivos médicos' },
    { key: 'seguridad', title: 'Seguridad y riesgos' },
    { key: 'alertas', title: 'Alertas' },
    { key: 'nutrition', title: 'Nutrición' },
    { key: 'elimination', title: 'Eliminación' },
    { key: 'fluidBalance', title: 'Balance hídrico' },
    { key: 'mobilitySkin', title: 'Movilidad y piel' },
    { key: 'psychosocial', title: 'Psicosocial' },
    { key: 'escalas', title: 'Escalas clínicas' },
    { key: 'examenes', title: 'Pendientes, exámenes y plan' },
    { key: 'medicacion', title: 'Medicación y tratamientos' },
    { key: 'adjuntos', title: 'Adjuntos' },
    { key: 'diagnosticos', title: 'Diagnósticos médicos/enfermería' },
    { key: 'outcomes', title: 'Resultados esperados (NOC)' },
    { key: 'evolucion', title: 'Evolución' },
    { key: 'resumen', title: 'Resumen / cierre de turno' },
    { key: 'bedsideChecklist', title: 'Bedside Checklist' },
    { key: 'firmas', title: 'Firmas' },
  ];
  return {
    HANDOVER_SECTIONS_INFO,
    resolveHandoverProfileRuntime: vi.fn((args: { unitId?: string | null; specialtyId?: string | null }) => ({
      context: {
        unitId: args.unitId ?? null,
        requestedSpecialtyId: args.specialtyId ?? null,
        specialtyId: args.specialtyId ?? null,
        specialtySource: 'requested',
        catalogUnitProfileId: null,
        unitProfileId: args.unitId ? `profile:${args.unitId}` : null,
        overlaySelections: [],
        catalogSpecialtyOverlayIds: [],
        specialtyOverlayIds: [],
        activeProfileIds: [],
        hasHumanSpecialtyOverride: false,
        usesCoreFallback: false,
      },
      pack: { id: 'mock-pack', label: 'Mock Pack' },
      basePack: { id: 'mock-pack', label: 'Mock Pack' },
      overlayPacks: [],
      activeOverlays: [],
      mergeTrace: [],
      sectionVisibility: HANDOVER_SECTIONS_INFO.reduce(
        (acc, section) => ({ ...acc, [section.key]: true }),
        {} as Record<string, boolean>,
      ),
      fieldVisibility: {
        'legacy-sbar-narrative': true,
        'legacy-medication-text': true,
        'legacy-nursing-diagnosis-text': true,
        'nic-coding-hint': false,
        'handover-timing-hint': false,
        'noc-outcomes': false,
      },
      features: {
        showHandoverTimingMetrics: false,
        showNicCoding: false,
        showNocOutcomes: false,
        hideLegacyFields: false,
      },
      checklistItems: [],
      requiredExtraFields: [],
      optionalExtraFields: [],
      focusAreas: [],
      explanations: [],
      suggestedScales: [],
      sentinelEvents: [],
      visibleOutputs: [],
      notes: [],
      medicationQuickPicks: [],
      treatmentQuickPicks: [],
    })),
  };
});
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: {
      userId: 'nurse-1',
      displayName: 'Nurse One',
      roles: ['nurse'],
      units: ['unit-1'],
      user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1' },
      accessToken: 'token',
    },
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(async () => undefined),
  }),
  getSession: vi.fn(async () => ({ userId: 'nurse-1', accessToken: 'token', units: ['unit-1'] })),
  ensureFreshAccessToken: vi.fn(async () => 'token'),
}));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: vi.fn() }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn() }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundleAsync: vi.fn(async () => ({ bundle: true })) }));
vi.mock('@/src/lib/fhir-validation', () => ({ validateBundle: vi.fn(() => ({ isValid: true, errors: [] })) }));
vi.mock('@/src/lib/audit', () => ({
  createAsyncStorageAuditStorage: () => ({ type: 'mock' }),
  appendAuditEvent: vi.fn(async () => undefined),
  makeAuditEvent: vi.fn(() => ({
    id: 'evt-1',
    type: 'handover_draft',
    userId: 'nurse-1',
    patientId: 'pat-1',
    at: '2024-01-01T00:00:00Z',
  })),
  queueAndFlushAuditEvent: vi.fn(async () => true),
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
vi.mock('@/src/lib/ai-sbar', () => ({
  generateSbarViaBackendResult: (...args: unknown[]) => generateSbarViaBackendResult(...args),
  refineSBARWithAIResult: (...args: unknown[]) => refineSBARWithAIResult(...args),
}));
vi.mock('@/src/lib/clinical-decision-log', () => ({
  logClinicalDecision: (...args: unknown[]) => logClinicalDecision(...args),
}));
vi.mock('@/src/lib/ai-suggestions', () => ({ fetchInterventionsSuggestions: vi.fn() }));
vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: 'pat-1', name: 'Paciente' } }),
}));
vi.mock('@/src/lib/hooks/useVitalTrends', () => ({
  useVitalTrends: () => ({ loading: false, error: null, data: [] }),
}));
vi.mock('@/src/lib/scores/handoverRisk', () => ({
  confirmHighRiskSubmission: vi.fn(async () => true),
  deriveRiskEvaluationFromValues: () => ({ total: 0 }),
}));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/components/FileAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/EliminationSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/FluidBalanceSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/MobilitySkinSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/NutritionSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/PsychosocialSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/OxygenGroupSection', () => ({
  default: () => <React.Fragment>Bloque de oxigenoterapia</React.Fragment>,
}));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
vi.mock('@/src/screens/components/PatientBanner', () => ({ PatientBanner: () => null }));
vi.mock('@/src/screens/components/OutcomesSection', () => ({ default: () => null }));
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

const getByPath = (value: any, path: string) =>
  path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), value);

const setByPath = (value: any, path: string, next: unknown) => {
  const keys = path.split('.');
  let ref = value;
  keys.slice(0, -1).forEach((key) => {
    if (!ref[key]) ref[key] = {};
    ref = ref[key];
  });
  ref[keys[keys.length - 1]] = next;
};

function buildFormMock(values: HandoverFormData) {
  const currentValues: any = { ...values };
  const setValue = vi.fn((key: string, nextValue: any) => {
    if (key.includes('.')) {
      setByPath(currentValues, key, nextValue);
    } else {
      currentValues[key] = nextValue;
    }
  });
  return {
    ...values,
    control: {},
    formState: { errors: {}, dirtyFields: {}, isSubmitting: false },
    watch: (fields?: string[] | string) => {
      if (Array.isArray(fields)) {
        return fields.map((field) => getByPath(currentValues, field));
      }
      if (typeof fields === 'string') {
        return getByPath(currentValues, fields);
      }
      return currentValues;
    },
    getValues: (field?: string) => {
      if (!field) return currentValues;
      return getByPath(currentValues, field);
    },
    getFieldState: () => ({ isDirty: false }),
    trigger: vi.fn(async () => true),
    handleSubmit: (onValid: any) => () => onValid(currentValues),
    setValue,
  } as any;
}

const baseValues: HandoverFormData = {
  patientId: 'pat-1',
  administrativeData: {
    unit: 'unit-1',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T00:00:00Z',
    shiftEnd: '2024-01-01T04:00:00Z',
    shiftType: 'Noche',
    incidents: [],
  },
  vitals: { tempC: 36 },
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
  dxMedicalStructured: [],
  dxNursingStructured: [],
  oxygenTherapy: null,
  meds: 'Paracetamol',
  medications: [],
  treatments: [],
  oxygenTherapyInput: { device: null, deviceDisplay: null, flowLMin: null, fio2: null },
  sbarSituation: 'situación',
  sbarBackground: 'antecedentes',
  sbarAssessment: 'evaluación',
  sbarRecommendation: 'recomendación',
  status: 'draft',
  closingSummary: '',
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  risksStructured: [],
  signatures: {},
  painAssessment: null,
  audioUri: null,
};

function renderHandoverForm(options?: {
  routeParams?: Record<string, unknown>;
  selectedUnitId?: string | undefined;
  defaultValuesOverride?: Partial<HandoverFormData>;
}) {
  const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
  if (options && Object.prototype.hasOwnProperty.call(options, 'selectedUnitId')) {
    useSelectedUnitId.mockImplementation(() => options.selectedUnitId);
  } else {
    useSelectedUnitId.mockImplementation(() => 'unit-1');
  }
  let formInstance: any;
  mockUseZodForm.mockImplementation((_: unknown, defaultValues: HandoverFormData) => {
    if (!formInstance) {
      formInstance = buildFormMock({
        ...defaultValues,
        ...options?.defaultValuesOverride,
        administrativeData: {
          ...defaultValues.administrativeData,
          ...(options?.defaultValuesOverride?.administrativeData ?? {}),
        },
      });
    }
    return formInstance;
  });

  const view = render(
    <HandoverForm
      navigation={navigation}
      route={{
        key: 'sbar-ai-traceability',
        name: 'HandoverForm',
        params: options?.routeParams ?? { patientId: 'pat-1', unitId: 'unit-1' },
      } as any}
    />,
  );

  return { view, navigation };
}

describe('HandoverForm SBAR AI traceability', () => {
  beforeAll(async () => {
    ({ default: HandoverForm } = await import('@/src/screens/HandoverForm'));
  });

  beforeEach(() => {
    flagState.values = { SHOW_SBAR: true };
    envState.AI_BACKEND_ENABLED = true;
    envState.AI_SBAR_ENABLED = true;
    pilotRuntimeState.pilotControlVersion = 0;
    useSelectedUnitId.mockReset();
    useSelectedUnitId.mockReturnValue('unit-1');
    mockUseZodForm.mockReset();
    generateSbarViaBackendResult.mockReset();
    refineSBARWithAIResult.mockReset();
    logClinicalDecision.mockClear();
  });

  it.each([
    {
      name: 'sin patientId',
      routeParams: { unitId: 'unit-1' },
      defaultValuesOverride: { ...baseValues, patientId: '' },
      selectedUnitId: 'unit-1',
    },
    {
      name: 'sin unitId trazable',
      routeParams: { patientId: 'pat-1' },
      defaultValuesOverride: baseValues,
      selectedUnitId: undefined,
    },
  ])('bloquea el flujo IA %s y no intenta logging shown', async ({ routeParams, defaultValuesOverride, selectedUnitId }) => {
    generateSbarViaBackendResult.mockResolvedValue({
      ok: true,
      result: {
        situation: 'IA situation',
        background: 'IA background',
        assessment: 'IA assessment',
        recommendation: 'IA recommendation',
        fullText: 'texto IA',
      },
    });
    refineSBARWithAIResult.mockResolvedValue({
      ok: true,
      summary: {
        situation: 'IA situation',
        background: 'IA background',
        assessment: 'IA assessment',
        recommendation: 'IA recommendation',
      },
    });

    const { view } = renderHandoverForm({ routeParams, defaultValuesOverride, selectedUnitId });

    const sbarSection = view.root.findByType(SbarSection);
    await act(async () => {
      await sbarSection.props.handleGenerateSbarWithAi();
      await sbarSection.props.handleRefineSbarWithAi();
    });

    await waitFor(() => {
      expect(view.getByText('Para usar SBAR asistida con IA primero vincula un paciente y una unidad técnica trazable.')).toBeTruthy();
    });

    expect(view.queryByText('Sugerencia SBAR en revisión humana')).toBeNull();
    expect(generateSbarViaBackendResult).not.toHaveBeenCalled();
    expect(refineSBARWithAIResult).not.toHaveBeenCalled();
    expect(logClinicalDecision).not.toHaveBeenCalled();
  });

  it('con patientId y unitId válidos muestra revisión humana y registra shown + accepted', async () => {
    generateSbarViaBackendResult.mockResolvedValue({
      ok: true,
      result: {
        situation: 'IA situation',
        background: 'IA background',
        assessment: 'IA assessment',
        recommendation: 'IA recommendation',
        fullText: 'texto IA',
      },
    });

    const { view } = renderHandoverForm();

    const sbarSection = view.root.findByType(SbarSection);
    await act(async () => {
      await sbarSection.props.handleGenerateSbarWithAi();
    });

    await waitFor(() => {
      expect(view.getByText('Sugerencia SBAR en revisión humana')).toBeTruthy();
    });

    await waitFor(() => {
      expect(logClinicalDecision).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          patientId: 'pat-1',
          unitId: 'unit-1',
          suggestionSource: 'ai_generate_sbar',
          decision: 'shown',
        }),
      );
    });

    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });

    await waitFor(() => {
      expect(logClinicalDecision).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          patientId: 'pat-1',
          unitId: 'unit-1',
          suggestionSource: 'ai_generate_sbar',
          decision: 'accepted',
          reasonCode: 'direct_apply',
        }),
      );
    });
  });

  it('con patientId y unitId válidos muestra revisión humana y registra shown + rejected', async () => {
    refineSBARWithAIResult.mockResolvedValue({
      ok: true,
      summary: {
        situation: 'Refined situation',
        background: 'Refined background',
        assessment: 'Refined assessment',
        recommendation: 'Refined recommendation',
      },
    });

    const { view } = renderHandoverForm();

    const sbarSection = view.root.findByType(SbarSection);
    await act(async () => {
      await sbarSection.props.handleRefineSbarWithAi();
    });

    await waitFor(() => {
      expect(view.getByText('Sugerencia SBAR en revisión humana')).toBeTruthy();
    });

    await waitFor(() => {
      expect(logClinicalDecision).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          patientId: 'pat-1',
          unitId: 'unit-1',
          suggestionSource: 'ai_refine_sbar',
          decision: 'shown',
        }),
      );
    });

    await act(async () => {
      view.root.findByType(SbarSection).props.onRejectPendingSbarSuggestion();
    });

    await waitFor(() => {
      expect(logClinicalDecision).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          patientId: 'pat-1',
          unitId: 'unit-1',
          suggestionSource: 'ai_refine_sbar',
          decision: 'rejected',
          reasonCode: 'not_relevant',
        }),
      );
    });
  });
});
