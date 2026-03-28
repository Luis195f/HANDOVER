import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverFormData } from '@/src/validation/schemas';

const enqueueBundle = vi.fn();
const buildHandoverBundleAsync = vi.fn(async () => ({ bundle: true }));
const validateBundle = vi.fn(() => ({ isValid: true, errors: [] }));
const ensureUnitAccess = vi.fn();
const confirmHighRiskSubmission = vi.fn(async () => true);
const mockUseZodForm = vi.fn();
const pilotRuntimeState = vi.hoisted(() => ({
  pilotControlVersion: 0,
  pilotContextCalls: [] as Array<{ unitId?: string; roles?: string[] }>,
  runtimeCalls: [] as Array<{ unitId?: string | null; specialtyId?: string | null; roles?: string[] | null }>,
}));

let HandoverForm: any;

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual('react-hook-form');
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

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
const useSelectedUnitId = vi.fn(() => 'unit-1');
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId, ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/config/pilotControl', () => ({
  isPilotFeatureEnabled: vi.fn(() => false),
  usePilotControlContext: vi.fn((context: { unitId?: string; roles?: string[] }) => {
    pilotRuntimeState.pilotContextCalls.push(context);
    return pilotRuntimeState.pilotControlVersion;
  }),
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
    { key: 'examenes', title: 'Exámenes y procedimientos' },
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
    resolveHandoverProfileRuntime: vi.fn((args: { unitId?: string | null; specialtyId?: string | null; roles?: string[] | null }) => {
      pilotRuntimeState.runtimeCalls.push(args);
      return {
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
      };
    }),
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
}));

vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: (...args: unknown[]) => ensureUnitAccess(...args) }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: (...args: unknown[]) => enqueueBundle(...args) }));
vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundleAsync: (...args: unknown[]) => buildHandoverBundleAsync(...args),
}));
vi.mock('@/src/lib/fhir-validation', () => ({ validateBundle: (...args: unknown[]) => validateBundle(...args) }));

// ✅ FIX: agregar sendAuditEvent y hacer appendAuditEvent async + makeAuditEvent consistente
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
  sendAuditEvent: vi.fn(async () => undefined),
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

vi.mock('@/src/lib/ai-suggestions', () => ({ fetchInterventionsSuggestions: vi.fn() }));

vi.mock('@/src/lib/scores/handoverRisk', () => ({
  confirmHighRiskSubmission: (...args: unknown[]) => confirmHighRiskSubmission(...args),
  deriveRiskEvaluationFromValues: () => ({ total: 0 }),
}));

vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: 'pat-1', name: 'Paciente' } }),
}));

vi.mock('@/src/lib/hooks/useVitalTrends', () => ({
  useVitalTrends: () => ({ loading: false, error: null, data: [] }),
}));

vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/EliminationSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/FluidBalanceSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/MobilitySkinSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/NutritionSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/PsychosocialSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
vi.mock('@/src/screens/components/PatientBanner', () => ({ PatientBanner: () => null }));
vi.mock('@/src/screens/components/OutcomesSection', () => ({ default: () => null }));

vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

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

function buildFormMock(values: HandoverFormData = baseValues) {
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
    watch: (fields?: string[]) => {
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
    handleSubmit: (onValid: any) => {
      const submit = () => onValid(currentValues);
      return submit;
    },
    setValue,
  } as any;
}

describe('HandoverForm drafts', () => {
  beforeAll(async () => {
    ({ default: HandoverForm } = await import('@/src/screens/HandoverForm'));
  });

  beforeEach(() => {
    enqueueBundle.mockReset();
    buildHandoverBundleAsync.mockReset();
    ensureUnitAccess.mockReset();
    confirmHighRiskSubmission.mockClear();
    mockUseZodForm.mockReset();
    pilotRuntimeState.pilotControlVersion = 0;
    pilotRuntimeState.pilotContextCalls.length = 0;
    pilotRuntimeState.runtimeCalls.length = 0;
    mockUseZodForm.mockImplementation((_: unknown, defaultValues: HandoverFormData) => buildFormMock(defaultValues));
  });


  it('cuando HIDE_LEGACY_FIELDS=false deriva valores legacy visibles desde canónicos', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;

    mockUseZodForm.mockImplementationOnce((_: unknown, defaultValues: HandoverFormData) =>
      buildFormMock({
        ...defaultValues,
        closingSummary: 'Resumen canónico',
        sbarFullText: '',
        meds: '',
        medications: [
          { id: 'm1', name: 'Paracetamol' },
          { id: 'm2', name: 'Heparina' },
        ],
      } as HandoverFormData),
    );

    await act(async () => {
      render(
        <HandoverForm
          navigation={navigation}
          route={{ key: '1', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
        />,
      );
    });

    const formInstance = mockUseZodForm.mock.results[0]?.value;
    await waitFor(() => {
      expect(formInstance.setValue).toHaveBeenCalledWith(
        'sbarFullText',
        'Resumen canónico',
        expect.objectContaining({ shouldDirty: false, shouldValidate: false }),
      );
      expect(formInstance.setValue).toHaveBeenCalledWith(
        'meds',
        'Paracetamol, Heparina',
        expect.objectContaining({ shouldDirty: false, shouldValidate: false }),
      );
    });
  });

  it('guarda borrador y encola con status draft', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const view = render(
      <HandoverForm
        navigation={navigation}
        route={{ key: '1', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
      />,
    );

    fireEvent.press(view.getByText('Guardar borrador'));

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalledTimes(1);
    });

    expect(buildHandoverBundleAsync).toHaveBeenCalled();
    const [handoverInput] = buildHandoverBundleAsync.mock.calls[0];
    expect(handoverInput.status).toBe('draft');

    // ✅ Ahora vuelve a ser el OK (ya no cae en el catch por el audit)
    expect(alertSpy).toHaveBeenCalledWith('OK', expect.stringContaining('Entrega encolada'));
  });

  it('muestra error y permite reintentar al fallar el encolado', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    enqueueBundle.mockRejectedValueOnce({ name: 'HTTPError', status: 504 });
    enqueueBundle.mockResolvedValueOnce(undefined);

    const view = render(
      <HandoverForm
        navigation={navigation}
        route={{ key: '1', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
      />,
    );

    fireEvent.press(view.getByText('Guardar borrador'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Error del servidor');

    const retryButton = (buttons as any[]).find((btn) => btn.text === 'Reintentar');
    expect(retryButton).toBeTruthy();

    await retryButton.onPress?.();

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalledTimes(2);
    });
  });

  it('aplica prefill de unidad desde los params', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    useSelectedUnitId.mockReturnValueOnce(undefined);

    await act(async () => {
      render(
        <HandoverForm
          navigation={navigation}
          route={{
            key: '1',
            name: 'HandoverForm',
            params: { patientId: 'pat-1', prefilledValues: { location: 'unit-prefill' } },
          } as any}
        />,
      );
    });

    await waitFor(() => {
      expect(mockUseZodForm).toHaveBeenCalled();
    });

    const [, defaultValues] = mockUseZodForm.mock.calls[0];
    expect(defaultValues.administrativeData.unit).toBe('unit-prefill');
  });

  it('alinea la unidad efectiva entre el fetch de pilot-control y la resolución del profile runtime', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;

    await act(async () => {
      render(
        <HandoverForm
          navigation={navigation}
          route={{
            key: 'pilot-unit',
            name: 'HandoverForm',
            params: {
              patientId: 'pat-1',
              unitId: 'route-unit',
              administrativeData: { ...baseValues.administrativeData, unit: 'admin-unit' },
            },
          } as any}
        />,
      );
    });

    expect(pilotRuntimeState.pilotContextCalls.slice(-1)[0]?.unitId).toBe('admin-unit');
    expect(pilotRuntimeState.runtimeCalls.length).toBeGreaterThan(0);
    expect(pilotRuntimeState.runtimeCalls.every((call) => call.unitId === 'admin-unit')).toBe(true);
  });

  it('recomputa el profile runtime cuando cambia el snapshot backend-driven relevante', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;

    const screen = render(
      <HandoverForm
        navigation={navigation}
        route={{ key: 'pilot-refresh', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
      />,
    );

    await waitFor(() => {
      expect(pilotRuntimeState.runtimeCalls.length).toBeGreaterThan(0);
    });

    pilotRuntimeState.runtimeCalls.length = 0;
    pilotRuntimeState.pilotControlVersion = 1;

    await act(async () => {
      screen.update(
        <HandoverForm
          navigation={navigation}
          route={{ key: 'pilot-refresh', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
        />,
      );
    });

    expect(pilotRuntimeState.runtimeCalls.length).toBeGreaterThan(0);
    expect(pilotRuntimeState.runtimeCalls.every((call) => call.unitId === 'unit-1')).toBe(true);
  });
});
