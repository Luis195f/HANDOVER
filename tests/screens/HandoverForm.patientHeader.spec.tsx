import React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const mockUsePatientSummary = vi.fn();
const mockUseZodForm = vi.fn();

vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: (...args: unknown[]) => mockUsePatientSummary(...args),
}));

vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({ session: null, loading: false, loginWithOAuth: vi.fn(), logout: vi.fn() }),
  getSession: vi.fn(async () => null),
}));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: vi.fn() }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn(async () => undefined) }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: vi.fn() }));
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
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));

function buildFormMock(patientId: string) {
  const baseAdministrative = {
    unit: '',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T00:00:00Z',
    shiftEnd: '2024-01-01T04:00:00Z',
    incidents: [],
  };

  return {
    control: {},
    formState: { errors: {} },
    handleSubmit: (fn: any) => fn,
    trigger: vi.fn(async () => true),
    getValues: (field?: string) => {
      if (!field) return { administrativeData: baseAdministrative, patientId, status: 'draft', signatures: {} };
      if (field === 'patientId') return patientId;
      if (field === 'administrativeData.unit') return baseAdministrative.unit;
      if (field === 'closingSummary') return '';
      if (field === 'signatures') return {};
      if (field === 'status') return 'draft';
      if (field === 'administrativeData.shiftStart') return baseAdministrative.shiftStart;
      return undefined;
    },
    getFieldState: () => ({ isDirty: false }),
    watch: (field?: string) => {
      if (field === 'patientId') return patientId;
      if (field === 'administrativeData.unit') return baseAdministrative.unit;
      if (field === 'signatures') return {};
      return undefined;
    },
    setValue: vi.fn(),
  };
}

describe('HandoverForm patient header', () => {
  beforeEach(() => {
    mockUsePatientSummary.mockReset();
    mockUseZodForm.mockReset();
  });

  it('muestra los datos del paciente cuando existe patientId', () => {
    mockUsePatientSummary.mockReturnValue({
      loading: false,
      error: null,
      summary: { id: '123', displayName: 'Ana Pérez', ageLabel: 'Edad 30 años', bedLabel: 'Cama 7B' },
    });
    mockUseZodForm.mockReturnValue(buildFormMock('123'));

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '1', name: 'HandoverForm', params: { patientId: '123' } } as any}
      />,
    );

    expect(getByText('Ana Pérez')).toBeTruthy();
    expect(getByText('Edad 30 años · Cama 7B')).toBeTruthy();
  });

  it('indica que no hay paciente vinculado cuando falta patientId', () => {
    mockUsePatientSummary.mockReturnValue({ loading: false, error: null, summary: null });
    mockUseZodForm.mockReturnValue(buildFormMock(''));

    const { getByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn() } as any} route={{ key: '2', name: 'HandoverForm', params: {} } as any} />,
    );

    expect(getByText('Paciente no vinculado')).toBeTruthy();
  });
});
