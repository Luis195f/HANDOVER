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
const netInfoFetchMock = vi.fn(async () => ({ isConnected: true, isInternetReachable: true }));
const flagState = vi.hoisted(() => ({
  values: {} as Record<string, boolean>,
}));
const mockUseZodForm = vi.fn();
const authState = vi.hoisted(() => ({
  session: {
    userId: 'nurse-1',
    displayName: 'Nurse One',
    roles: ['nurse'],
    units: ['unit-1'],
    user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1' },
    accessToken: 'token',
  },
  capabilities: {
    userSub: 'auth0|nurse-1',
    roles: ['nurse'],
    scopes: ['handover:write'],
    unitIds: ['unit-1'],
    permissions: {
      canWriteHandover: true,
      canReadPatients: false,
      canCreatePatients: false,
      canSignHandover: false,
      canViewAudit: false,
      canSendAuditEvents: true,
      isAdmin: false,
    },
    scopeCatalog: [],
    fhir: { version: 'R4', transaction: true, profiles: [] },
  },
}));
const pilotRuntimeState = vi.hoisted(() => ({
  pilotControlVersion: 0,
  pilotContextCalls: [] as Array<{ unitId?: string; roles?: string[] }>,
  runtimeCalls: [] as Array<{ unitId?: string | null; specialtyId?: string | null; roles?: string[] | null }>,
  runtimeOverride: null as null | Record<string, unknown>,
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

vi.mock('@/src/config/flags', () => ({
  isOn: (name: string) => flagState.values[name] ?? false,
}));
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
    resolveHandoverProfileRuntime: vi.fn((args: { unitId?: string | null; specialtyId?: string | null; roles?: string[] | null }) => {
      pilotRuntimeState.runtimeCalls.push(args);
      const runtime = {
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

      return pilotRuntimeState.runtimeOverride
        ? {
            ...runtime,
            ...pilotRuntimeState.runtimeOverride,
            context: {
              ...runtime.context,
              ...(pilotRuntimeState.runtimeOverride.context as Record<string, unknown> | undefined),
            },
            pack: {
              ...runtime.pack,
              ...(pilotRuntimeState.runtimeOverride.pack as Record<string, unknown> | undefined),
            },
            basePack: {
              ...runtime.basePack,
              ...(pilotRuntimeState.runtimeOverride.basePack as Record<string, unknown> | undefined),
            },
            sectionVisibility: {
              ...runtime.sectionVisibility,
              ...(pilotRuntimeState.runtimeOverride.sectionVisibility as Record<string, boolean> | undefined),
            },
            fieldVisibility: {
              ...runtime.fieldVisibility,
              ...(pilotRuntimeState.runtimeOverride.fieldVisibility as Record<string, boolean> | undefined),
            },
            features: {
              ...runtime.features,
              ...(pilotRuntimeState.runtimeOverride.features as Record<string, unknown> | undefined),
            },
          }
        : runtime;
    }),
  };
});

vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: authState.session,
    capabilities: authState.capabilities,
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(async () => undefined),
  }),
  getSession: vi.fn(async () => ({
    userId: authState.session.userId,
    accessToken: authState.session.accessToken,
    units: authState.session.units,
  })),
}));

vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: (...args: unknown[]) => ensureUnitAccess(...args) }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: (...args: unknown[]) => enqueueBundle(...args) }));
vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundleAsync: (...args: unknown[]) => buildHandoverBundleAsync(...args),
}));
vi.mock('@/src/lib/fhir-validation', () => ({ validateBundle: (...args: unknown[]) => validateBundle(...args) }));

// ✅ FIX: mantener el seam de auditoría sin disparar la red real
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
vi.mock('@/src/lib/netinfo', () => ({
  default: {
    fetch: (...args: unknown[]) => netInfoFetchMock(...args),
  },
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
vi.mock('@/src/screens/components/OxygenGroupSection', () => ({
  default: () => <React.Fragment>Bloque de oxigenoterapia</React.Fragment>,
}));
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
    pilotRuntimeState.runtimeOverride = null;
    flagState.values = {};
    netInfoFetchMock.mockReset();
    netInfoFetchMock.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    authState.session = {
      userId: 'nurse-1',
      displayName: 'Nurse One',
      roles: ['nurse'],
      units: ['unit-1'],
      user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1' },
      accessToken: 'token',
    };
    authState.capabilities = {
      userSub: 'auth0|nurse-1',
      roles: ['nurse'],
      scopes: ['handover:write'],
      unitIds: ['unit-1'],
      permissions: {
        canWriteHandover: true,
        canReadPatients: false,
        canCreatePatients: false,
        canSignHandover: false,
        canViewAudit: false,
        canSendAuditEvents: true,
        isAdmin: false,
      },
      scopeCatalog: [],
      fhir: { version: 'R4', transaction: true, profiles: [] },
    };
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

    const [, initialDefaultValues] = mockUseZodForm.mock.calls[0];
    expect(initialDefaultValues.dxMedical).toEqual({
      system: SNOMED_SYSTEM,
      code: '',
      display: '',
    });
    expect(initialDefaultValues.dxMedicalStructured).toEqual([]);

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

    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('OK');
    expect(message).toContain('Entrega encolada');
    expect(navigation.goBack).not.toHaveBeenCalled();
    const queueButton = (buttons as any[]).find((btn) => btn.text === 'Ver cola');
    expect(queueButton).toBeTruthy();
  });

  it('expone feedback offline honesto al encolar un borrador sin red', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    netInfoFetchMock.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });

    const view = render(
      <HandoverForm
        navigation={navigation}
        route={{ key: 'offline-draft', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any}
      />,
    );

    fireEvent.press(view.getByText('Guardar borrador'));

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalledTimes(1);
    });

    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('OK');
    expect(message).toContain('Sin conexión');
    expect(message).toContain('cola');
    expect(navigation.goBack).not.toHaveBeenCalled();

    const queueButton = (buttons as any[]).find((btn) => btn.text === 'Ver cola');
    expect(queueButton).toBeTruthy();
    await queueButton.onPress?.();
    expect(navigation.navigate).toHaveBeenCalledWith('SyncCenter');
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
            params: {
              patientId: 'pat-1',
              prefilledValues: { location: 'unit-prefill', dxText: 'Asma' },
            },
          } as any}
        />,
      );
    });

    await waitFor(() => {
      expect(mockUseZodForm).toHaveBeenCalled();
    });

    const [, defaultValues] = mockUseZodForm.mock.calls[0];
    expect(defaultValues.administrativeData.unit).toBe('unit-prefill');
    expect(defaultValues.dxMedical).toEqual({
      system: SNOMED_SYSTEM,
      code: '61277005',
      display: 'Asma',
    });
    expect(defaultValues.dxMedicalStructured).toEqual([]);
  });

  it('alinea la unidad técnica canónica entre pilot-control y profile runtime aunque el texto administrativo difiera', async () => {
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
              unitIdParam: 'canonical-route-unit',
              administrativeData: { ...baseValues.administrativeData, unit: 'admin-unit' },
            },
          } as any}
        />,
      );
    });

    expect(pilotRuntimeState.pilotContextCalls.slice(-1)[0]?.unitId).toBe('canonical-route-unit');
    expect(pilotRuntimeState.runtimeCalls.length).toBeGreaterThan(0);
    expect(pilotRuntimeState.runtimeCalls.every((call) => call.unitId === 'canonical-route-unit')).toBe(true);
  });

  it('no genera churn de contexto backend cuando cambia el texto libre de la unidad', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    useSelectedUnitId.mockReturnValue('unit-1');

    const screen = render(
      <HandoverForm
        navigation={navigation}
        route={{
          key: 'pilot-typed-unit',
          name: 'HandoverForm',
          params: {
            patientId: 'pat-1',
            administrativeData: { ...baseValues.administrativeData, unit: 'U' },
          },
        } as any}
      />,
    );

    await waitFor(() => {
      expect(pilotRuntimeState.pilotContextCalls.length).toBeGreaterThan(0);
    });

    pilotRuntimeState.pilotContextCalls.length = 0;
    pilotRuntimeState.runtimeCalls.length = 0;

    for (const typedUnit of ['UC', 'UCI', 'UCI Adulto']) {
      mockUseZodForm.mockImplementationOnce((_: unknown, defaultValues: HandoverFormData) =>
        buildFormMock({
          ...defaultValues,
          administrativeData: {
            ...defaultValues.administrativeData,
            unit: typedUnit,
          },
        }),
      );

      await act(async () => {
        screen.update(
          <HandoverForm
            navigation={navigation}
            route={{
              key: 'pilot-typed-unit',
              name: 'HandoverForm',
              params: {
                patientId: 'pat-1',
                administrativeData: { ...baseValues.administrativeData, unit: typedUnit },
              },
            } as any}
          />,
        );
      });
    }

    expect(pilotRuntimeState.pilotContextCalls.length).toBeGreaterThan(0);
    expect(new Set(pilotRuntimeState.pilotContextCalls.map((call) => call.unitId))).toEqual(new Set(['unit-1']));
    expect(pilotRuntimeState.runtimeCalls.length).toBeGreaterThan(0);
    expect(new Set(pilotRuntimeState.runtimeCalls.map((call) => call.unitId))).toEqual(new Set(['unit-1']));
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

  it('en fallback Core muestra los dominios recuperados para piloto sin duplicar contingencias en el cierre', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    authState.session = {
      ...authState.session,
      units: ['unknown-unit'],
      user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unknown-unit' },
    };
    authState.capabilities = {
      ...authState.capabilities,
      unitIds: ['unknown-unit'],
      permissions: {
        ...authState.capabilities.permissions,
        canWriteHandover: true,
      },
    };

    flagState.values = {
      SHOW_OXY: true,
    };
    pilotRuntimeState.runtimeOverride = {
      context: {
        unitId: 'unknown-unit',
        unitProfileId: null,
        usesCoreFallback: true,
        activeProfileIds: ['handover-core'],
      },
      pack: { id: 'handover-core', label: 'HANDOVER Core' },
      basePack: { id: 'handover-core', label: 'HANDOVER Core' },
      sectionVisibility: {
        turno: true,
        paciente: true,
        sbar: true,
        signos: true,
        oxigenoterapia: true,
        dispositivos: true,
        seguridad: true,
        alertas: true,
        nutrition: false,
        elimination: false,
        fluidBalance: false,
        mobilitySkin: false,
        psychosocial: false,
        escalas: true,
        examenes: true,
        medicacion: false,
        adjuntos: false,
        diagnosticos: true,
        outcomes: false,
        evolucion: true,
        resumen: true,
        bedsideChecklist: true,
        firmas: true,
      },
    };

    const view = render(
      <HandoverForm
        navigation={navigation}
        route={{
          key: 'core-fallback',
          name: 'HandoverForm',
          params: { patientId: 'pat-1', unitId: 'unknown-unit' },
        } as any}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('HANDOVER Core activo')).toBeTruthy();
      expect(view.getByText('Oxigenoterapia')).toBeTruthy();
      expect(view.getByText('Escalas clínicas')).toBeTruthy();
      expect(view.getByText('Pendientes, exámenes y plan')).toBeTruthy();
      expect(view.getByText('Plan inmediato y contingencias')).toBeTruthy();
      expect(view.getByText('Checklist de cabecera de cama')).toBeTruthy();
    });

    const renderedTree = JSON.stringify(view.toJSON());
    expect(renderedTree.match(/Plan inmediato y contingencias/g) ?? []).toHaveLength(1);
  });
});
