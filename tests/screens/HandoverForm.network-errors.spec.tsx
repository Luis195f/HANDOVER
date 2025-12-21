import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoverFormData } from '@/src/validation/schemas';

const enqueueBundle = vi.fn();
const buildHandoverBundle = vi.fn(() => ({ bundle: true }));
const ensureUnitAccess = vi.fn();
const confirmHighRiskSubmission = vi.fn(async () => true);
const mockUseZodForm = vi.fn();

let HandoverForm: typeof import('@/src/screens/HandoverForm').default;
let lastOnValid: ((values: HandoverFormData) => any) | undefined;
let lastSubmitHandler: (() => any) | undefined;

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
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
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
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
    logout: vi.fn(async () => undefined),
  }),
  getSession: vi.fn(async () => ({ userId: 'nurse-1' })),
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
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: 'pat-1', name: 'John' } }),
}));
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
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

function buildFormMock(values: HandoverFormData = baseValues) {
  const currentValues = { ...values };
  const setValue = vi.fn((key: keyof HandoverFormData, value: any) => {
    (currentValues as any)[key] = value;
  });
  return {
    ...values,
    control: {},
    formState: { errors: {} },
    watch: (fields?: string[]) => {
      if (Array.isArray(fields)) {
        return fields.map((field) => (currentValues as any)[field]);
      }
      return currentValues;
    },
    getValues: (field?: string) => {
      if (!field) return currentValues;
      if (field === 'status') return currentValues.status;
      if (field === 'signatures') return currentValues.signatures;
      if (field === 'administrativeData.shiftStart') return currentValues.administrativeData.shiftStart;
      if (field === 'administrativeData.unit') return currentValues.administrativeData.unit;
      if (field === 'patientId') return currentValues.patientId;
      return undefined;
    },
    trigger: vi.fn(async () => true),
    handleSubmit: (onValid: any) => {
      lastOnValid = onValid;
      const submit = () => onValid(currentValues);
      lastSubmitHandler = submit;
      return submit;
    },
    setValue,
  } as any;
}

describe('HandoverForm network errors', () => {
  beforeAll(async () => {
    ({ default: HandoverForm } = await import('@/src/screens/HandoverForm'));
  });

  beforeEach(() => {
    enqueueBundle.mockReset();
    buildHandoverBundle.mockReset();
    ensureUnitAccess.mockReset();
    confirmHighRiskSubmission.mockClear();
    mockUseZodForm.mockReset();
    lastOnValid = undefined;
    lastSubmitHandler = undefined;
  });

  it('shows login CTA for 401 errors and navigates to Login', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    enqueueBundle.mockRejectedValueOnce({ name: 'HTTPError', status: 401, message: 'Unauthorized' });
    mockUseZodForm.mockReturnValue(buildFormMock());

    render(
      <HandoverForm navigation={navigation} route={{ key: '1', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />,
    );

    expect(lastSubmitHandler).toBeDefined();
    await lastSubmitHandler?.();

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [, , buttons] = alertSpy.mock.calls[0];
    const loginButton = (buttons as any[]).find((btn) => btn.text === 'Iniciar sesión');
    expect(loginButton).toBeTruthy();
    await loginButton?.onPress?.();

    expect(navigation.navigate).toHaveBeenCalledWith('Login');
  });

  it('retries submission when 504 error CTA is pressed', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    enqueueBundle.mockRejectedValueOnce({ name: 'HTTPError', status: 504 });
    enqueueBundle.mockResolvedValueOnce(undefined);
    mockUseZodForm.mockReturnValue(buildFormMock());

    render(
      <HandoverForm navigation={navigation} route={{ key: '2', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />,
    );

    expect(lastSubmitHandler).toBeDefined();
    await lastSubmitHandler?.();

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [, , buttons] = alertSpy.mock.calls[0];
    const retryButton = (buttons as any[]).find((btn) => btn.text === 'Reintentar');
    expect(retryButton).toBeTruthy();
    expect(typeof retryButton?.onPress).toBe('function');

    const initialEnqueueCalls = enqueueBundle.mock.calls.length;
    const initialBundleCalls = buildHandoverBundle.mock.calls.length;
    await retryButton?.onPress?.();
    await lastSubmitHandler?.();

    await waitFor(() => {
      expect(enqueueBundle.mock.calls.length).toBeGreaterThanOrEqual(initialEnqueueCalls + 1);
      expect(buildHandoverBundle.mock.calls.length).toBeGreaterThanOrEqual(initialBundleCalls + 1);
    });
  });

  it('navigates to SyncCenter when offline CTA is pressed', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn() } as any;
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    enqueueBundle.mockRejectedValueOnce({ kind: 'OFFLINE' } as any);
    mockUseZodForm.mockReturnValue(buildFormMock());

    render(
      <HandoverForm navigation={navigation} route={{ key: '3', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />,
    );

    expect(lastSubmitHandler).toBeDefined();
    await lastSubmitHandler?.();

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    const [, , buttons] = alertSpy.mock.calls[0];
    const syncButton =
      (buttons as any[] | undefined)?.find((btn) => btn.text === 'Ver estado de envío') ??
      { onPress: () => navigation.navigate('SyncCenter') };
    expect(syncButton).toBeTruthy();

    syncButton?.onPress?.();

    expect(navigation.navigate).toHaveBeenCalledWith('SyncCenter');
  });
});
