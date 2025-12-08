import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const enqueueBundle = vi.fn();
const buildHandoverBundle = vi.fn(() => ({ bundle: true }));
const ensureUnitAccess = vi.fn();
const confirmHighRiskSubmission = vi.fn(async () => true);
const mockUseZodForm = vi.fn();

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
    logout: vi.fn(),
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

const baseValues = {
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
  sbarSituation: 'sit',
  sbarBackground: 'bg',
  sbarAssessment: 'assess',
  sbarRecommendation: 'rec',
  painAssessment: null,
  signatures: {},
  status: 'draft',
  closingSummary: 'Resumen final',
};

function buildFormMock(values = { ...baseValues }) {
  const current = { ...values } as any;
  const setValue = vi.fn((field: string, value: any) => {
    if (field === 'status') current.status = value;
    if (field === 'patientId') current.patientId = value;
    if (field === 'administrativeData.unit') current.administrativeData.unit = value;
  });

  return {
    control: {},
    formState: { errors: {} },
    handleSubmit: (onValid: any) => () => onValid({ ...current }),
    trigger: vi.fn(async () => true),
    getValues: (field?: string) => {
      if (!field) return current;
      if (field === 'status') return current.status;
      if (field === 'signatures') return current.signatures;
      if (field === 'administrativeData.shiftStart') return current.administrativeData.shiftStart;
      if (field === 'administrativeData.unit') return current.administrativeData.unit;
      if (field === 'patientId') return current.patientId;
      return undefined;
    },
    getFieldState: () => ({ isDirty: false }),
    watch: (field?: string) => {
      if (field === 'patientId') return current.patientId;
      if (field === 'administrativeData.unit') return current.administrativeData.unit;
      if (field === 'signatures') return current.signatures;
      if (field === 'status') return current.status;
      return undefined;
    },
    setValue,
  };
}

describe('HandoverForm validation & envío', () => {
  beforeEach(() => {
    enqueueBundle.mockReset();
    buildHandoverBundle.mockReset();
    ensureUnitAccess.mockReset();
    confirmHighRiskSubmission.mockClear();
    mockUseZodForm.mockReset();
  });

  it('envía un borrador válido y encola el bundle', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockUseZodForm.mockReturnValue(buildFormMock());

    const { getByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any} route={{ key: '1', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />,
    );

    fireEvent.press(getByText('Guardar borrador'));

    await waitFor(() => {
      expect(enqueueBundle).toHaveBeenCalledWith({ bundle: true }, expect.objectContaining({ patientId: 'pat-1', unitId: 'unit-1' }));
    });
    expect(buildHandoverBundle).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('OK', expect.stringContaining('Entrega encolada'));
  });

  it('muestra error de validación cuando faltan campos obligatorios', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockUseZodForm.mockReturnValue({
      ...buildFormMock(),
      handleSubmit: (_onValid: any, onInvalid: any) => () => onInvalid?.({ message: 'Faltan datos' }),
    });

    const { getByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any} route={{ key: '2', name: 'HandoverForm', params: { patientId: 'pat-1', unitId: 'unit-1' } } as any} />,
    );

    fireEvent.press(getByText('Guardar borrador'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Faltan datos');
    });
    expect(enqueueBundle).not.toHaveBeenCalled();
  });
});
