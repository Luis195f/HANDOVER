import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from 'js-sha256';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { SbarSection } from '@/src/screens/handover/SbarSection';
import { zHandover, type HandoverFormData } from '@/src/validation/schemas';

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
    Controller: ({ render, defaultValue, name }: any) =>
      render({
        field: { onChange: (value: string) => currentContext.setValue(name, value), onBlur: vi.fn(), value: defaultValue },
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
vi.mock('@/src/lib/ai-sbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/ai-sbar')>();
  return {
    ...actual,
    generateSbarViaBackendResult: (...args: unknown[]) => generateSbarViaBackendResult(...args),
    refineSBARWithAIResult: (...args: unknown[]) => refineSBARWithAIResult(...args),
  };
});
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

const validDraft = (values: HandoverFormData): HandoverFormData => ({
  ...values,
  oxygenTherapy: undefined,
  painAssessment: undefined,
  audioUri: undefined,
  administrativeData: { ...values.administrativeData, staffIn: ['Nurse A'], staffOut: ['Nurse B'] },
  bedsideChecklist: {
    patientIdentityConfirmed: true, allergiesReviewed: true, linesAndDevicesChecked: true,
    medicationPlanReviewed: true, safetyMeasuresApplied: true, questionsAnswered: true,
  },
});

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

  return { view, navigation, form: formInstance };
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

    const { view, form, navigation } = renderHandoverForm();

    const sbarSection = view.root.findByType(SbarSection);
    await act(async () => {
      await sbarSection.props.handleGenerateSbarWithAi();
    });

    await waitFor(() => {
      expect(view.getByText('Sugerencia SBAR en revisión humana')).toBeTruthy();
    });

    const sentContext = generateSbarViaBackendResult.mock.calls[0]?.[1];
    expect(sentContext).not.toHaveProperty('patientId');
    expect(sentContext).not.toHaveProperty('administrativeData');
    expect(sentContext).not.toHaveProperty('staff');

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

    expect(view.queryByText('Resumen automático local basado en los datos del formulario; no es una inferencia clínica de IA.')).toBeNull();
    expect(view.getByText('Texto SBAR generado con IA externa y aceptado por un profesional.')).toBeTruthy();
    const accepted = form.getValues('sbarProvenance');
    expect(accepted.sbarSituation).toMatchObject({ source: 'external-ai', acceptedBy: 'nurse-1', decisionHash: expect.any(String) });
    expect(accepted.closingSummary).toMatchObject({ source: 'external-ai', acceptedAt: expect.any(String) });
    expect(accepted.sbarSituation.version).toBeUndefined();
    const saved = JSON.parse(JSON.stringify(form.getValues()));
    expect(saved.sbarProvenance).toEqual(accepted);

    await act(async () => {
      fireEvent.changeText(view.getByTestId('handover-sbar-situation'), 'IA situation edited');
      form.setValue('sbarSituation', 'IA situation edited');
    });
    expect(form.getValues('sbarProvenance').sbarSituation).toMatchObject({
      source: 'ai-edited-by-human',
      acceptedBy: 'nurse-1',
      acceptedAt: accepted.sbarSituation.acceptedAt,
      decisionHash: accepted.sbarSituation.decisionHash,
    });
    expect(form.getValues('sbarProvenance').sbarBackground.source).toBe('external-ai');
    await act(async () => {
      view.update(<HandoverForm navigation={navigation} route={{ key: 'sbar-ai-traceability', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />);
    });
    expect(view.getByText('Texto asistido por IA externa y editado por un profesional.')).toBeTruthy();

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

  it('keeps a typed closing summary valid after local generation and preserves AI acceptance after a human edit', async () => {
    generateSbarViaBackendResult.mockResolvedValue({ ok: false, error: { code: 'UNCONFIGURED' } });
    const { view, form } = renderHandoverForm({ defaultValuesOverride: validDraft(baseValues) });
    await act(async () => {
      await view.root.findByType(SbarSection).props.handleGenerateSbarWithAi();
    });
    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });
    expect(form.getValues('sbarProvenance').closingSummary.source).toBe('local-deterministic');
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), 'Local summary edited'));
    expect(form.getValues('sbarProvenance').closingSummary).toEqual({ source: 'clinician-authored', contentHash: sha256('Local summary edited') });
    const localValidation = zHandover.safeParse(form.getValues());
    expect(localValidation.success ? [] : localValidation.error.issues.map((issue) => issue.path.join('.'))).toEqual([]);

    generateSbarViaBackendResult.mockResolvedValue({ ok: true, result: {
      situation: 'AI situation', background: 'AI background', assessment: 'AI assessment',
      recommendation: 'AI recommendation', fullText: 'AI summary',
    } });
    await act(async () => {
      await view.root.findByType(SbarSection).props.handleGenerateSbarWithAi();
    });
    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });
    const accepted = form.getValues('sbarProvenance').closingSummary;
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), 'AI summary edited'));
    expect(form.getValues('sbarProvenance').closingSummary).toEqual({
      ...accepted, source: 'ai-edited-by-human', contentHash: sha256('AI summary edited'),
    });
    const editedValidation = zHandover.safeParse(form.getValues());
    expect(editedValidation.success ? [] : editedValidation.error.issues.map((issue) => issue.path.join('.'))).toEqual([]);
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), 'AI summary edited'));
    expect(form.getValues('sbarProvenance').closingSummary).toEqual({
      ...accepted, source: 'ai-edited-by-human', contentHash: sha256('AI summary edited'),
    });
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), ''));
    expect(form.getValues('sbarProvenance').closingSummary).toBeUndefined();
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), '   '));
    expect(form.getValues('sbarProvenance').closingSummary).toBeUndefined();
    const clearedValidation = zHandover.safeParse(form.getValues());
    expect(clearedValidation.success ? [] : clearedValidation.error.issues.map((issue) => issue.path.join('.'))).toEqual([]);
  });

  it('removes provenance for emptied AI sections and accepts whitespace-only optional text', async () => {
    generateSbarViaBackendResult.mockResolvedValueOnce({ ok: true, result: {
      situation: 'Prior situation', background: 'Background', assessment: 'Assessment',
      recommendation: 'Recommendation', fullText: 'Prior summary',
    } }).mockResolvedValueOnce({ ok: true, result: {
      situation: '   ', background: 'Background', assessment: 'Assessment',
      recommendation: 'Recommendation', fullText: '   ',
    } });
    const { view, form } = renderHandoverForm({ defaultValuesOverride: validDraft(baseValues) });
    await act(async () => {
      await view.root.findByType(SbarSection).props.handleGenerateSbarWithAi();
    });
    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });
    expect(form.getValues('sbarProvenance').sbarSituation.source).toBe('external-ai');
    await act(async () => {
      await view.root.findByType(SbarSection).props.handleGenerateSbarWithAi();
    });
    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });
    expect(form.getValues('sbarProvenance').sbarSituation).toBeUndefined();
    expect(form.getValues('sbarProvenance').closingSummary).toBeUndefined();
    expect(form.getValues('sbarProvenance').sbarBackground.source).toBe('external-ai');
    const emptyValidation = zHandover.safeParse(form.getValues());
    expect(emptyValidation.success ? [] : emptyValidation.error.issues.map((issue) => issue.path.join('.'))).toEqual([]);
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), ''));
    expect(form.getValues('sbarProvenance').closingSummary).toBeUndefined();
    await act(async () => fireEvent.changeText(view.getByPlaceholderText('Resumen breve para el equipo entrante'), '   '));
    expect(form.getValues('sbarProvenance').closingSummary).toBeUndefined();
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

    const { view, form } = renderHandoverForm();
    const existingProvenance = JSON.parse(JSON.stringify(form.getValues('sbarProvenance') ?? null));

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
    expect(form.getValues('sbarProvenance') ?? null).toEqual(existingProvenance);

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

  it('keeps imported SBAR unverified until a clinician edits the affected section', async () => {
    const { view, form } = renderHandoverForm({ defaultValuesOverride: baseValues });
    expect(view.getByText('Procedencia de este texto no acreditada.')).toBeTruthy();
    expect(form.getValues('sbarProvenance')).toBeUndefined();

    await act(async () => {
      fireEvent.changeText(view.getByTestId('handover-sbar-situation'), 'clinical edit');
      form.setValue('sbarSituation', 'clinical edit');
    });
    expect(form.getValues('sbarProvenance').sbarSituation.source).toBe('clinician-authored');
    expect(form.getValues('sbarProvenance').sbarBackground).toBeUndefined();
  });

  it('renders restored provenance from the form values rather than the demo flag', () => {
    const { view } = renderHandoverForm({ defaultValuesOverride: {
      ...baseValues,
      closingSummary: 'Restored external SBAR',
      sbarProvenance: { closingSummary: {
        source: 'external-ai', contentHash: sha256('Restored external SBAR'),
        acceptedBy: 'nurse-1', acceptedAt: '2026-10-20T10:00:00.000Z', decisionHash: sha256('synthetic decision'),
      } },
    } });
    expect(view.getByText('Texto SBAR generado con IA externa y aceptado por un profesional.')).toBeTruthy();
    expect(view.queryByText('Resumen automático local basado en los datos del formulario; no es una inferencia clínica de IA.')).toBeNull();
  });

  it('records a deterministic fallback as local rather than external AI', async () => {
    generateSbarViaBackendResult.mockResolvedValue({ ok: false, error: { code: 'UNCONFIGURED' } });
    const { view, form } = renderHandoverForm();
    await act(async () => {
      await view.root.findByType(SbarSection).props.handleGenerateSbarWithAi();
    });
    await act(async () => {
      view.root.findByType(SbarSection).props.onAcceptPendingSbarSuggestion();
    });
    expect(form.getValues('sbarProvenance').sbarSituation.source).toBe('local-deterministic');
    expect(view.getByText('Resumen automático local basado en los datos del formulario; no es una inferencia clínica de IA.')).toBeTruthy();
  });
});
