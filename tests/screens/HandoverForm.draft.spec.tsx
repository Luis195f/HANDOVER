import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoverFormData } from '@/src/validation/schemas';

const enqueueBundle = vi.fn();
const buildHandoverBundle = vi.fn(() => ({ bundle: true }));
const ensureUnitAccess = vi.fn();
const confirmHighRiskSubmission = vi.fn(async () => true);
const mockUseZodForm = vi.fn();

let HandoverForm: any;

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual('react-hook-form');
  let currentContext: any;
  return {
    ...actual,
    Controller: ({ render, defaultValue }: any) =>
      render({ field: { onChange: vi.fn(), onBlur: vi.fn(), value: defaultValue }, fieldState: { error: undefined } }),
    FormProvider: ({ children, ...ctx }: any) => {
      currentContext = ctx;
      return <>{children}</>;
    },
    useFormContext: () => currentContext,
    useFieldArray: () => ({ fields: [], append: vi.fn(), remove: vi.fn() }),
  };
});

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
const useSelectedUnitId = vi.fn(() => 'unit-1');
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId, ALL_UNITS_OPTION: '__all__' }));
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
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: (...args: unknown[]) => buildHandoverBundle(...args) }));
vi.mock('@/src/lib/audit', () => ({
  createAsyncStorageAuditStorage: () => ({ type: 'mock' }),
  appendAuditEvent: vi.fn(),
  makeAuditEvent: vi.fn(),
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
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
vi.mock('@/src/screens/components/PatientBanner', () => ({ PatientBanner: () => null }));
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
  signatures: [],
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
    buildHandoverBundle.mockReset();
    ensureUnitAccess.mockReset();
    confirmHighRiskSubmission.mockClear();
    mockUseZodForm.mockReset();
    mockUseZodForm.mockImplementation((_: unknown, defaultValues: HandoverFormData) =>
      buildFormMock(defaultValues),
    );
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

    expect(buildHandoverBundle).toHaveBeenCalled();
    const [handoverInput] = buildHandoverBundle.mock.calls[0];
    expect(handoverInput.status).toBe('draft');
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
});
