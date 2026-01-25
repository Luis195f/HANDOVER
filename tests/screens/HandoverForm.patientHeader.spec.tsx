import React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

const mockUsePatientSummary = vi.fn();
const mockUseZodForm = vi.fn();

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  let currentContext: any;
  return {
    ...actual,
    FormProvider: ({ children, ...ctx }: any) => {
      currentContext = ctx;
      return <>{children}</>;
    },
    useFormContext: () => currentContext,
    Controller: ({ render, defaultValue }: any) =>
      render({ field: { onChange: vi.fn(), onBlur: vi.fn(), value: defaultValue }, fieldState: { error: undefined } }),
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

vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: (...args: unknown[]) => mockUsePatientSummary(...args),
}));

vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: null,
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(),
  }),
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
vi.mock('@/src/screens/components/EliminationSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/FluidBalanceSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/MobilitySkinSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/NutritionSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/PsychosocialSection', () => ({ default: () => null }));
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
    shiftType: 'Noche',
    incidents: [],
  };

  return {
    control: {},
    formState: { errors: {} },
    handleSubmit: (fn: any) => fn,
    trigger: vi.fn(async () => true),
    getValues: (field?: string) => {
      if (!field)
        return {
          administrativeData: baseAdministrative,
          patientId,
          status: 'draft',
          signatures: {},
          dxMedical: { system: SNOMED_SYSTEM, code: '', display: '' },
          dxNursing: { system: SNOMED_SYSTEM, code: '', display: '' },
        };
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
      if (Array.isArray(field)) {
        return field.map((key) => {
          if (key === 'patientId') return patientId;
          if (key === 'signatures') return {};
          if (key === 'administrativeData.unit') return baseAdministrative.unit;
          return undefined;
        });
      }
      if (!field) {
        return {
          administrativeData: baseAdministrative,
          patientId,
          status: 'draft',
          signatures: {},
          dxMedical: { system: SNOMED_SYSTEM, code: '', display: '' },
          dxNursing: { system: SNOMED_SYSTEM, code: '', display: '' },
          risksStructured: [],
          vitals: {},
          braden: null,
          oxygenTherapy: null,
        };
      }
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
      summary: { id: '123', name: 'Ana Pérez', gender: 'female', age: 30, bed: '7B', mrn: 'MRN-7' },
    });
    mockUseZodForm.mockReturnValue(buildFormMock('123'));

    const { getByTestId } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '1', name: 'HandoverForm', params: { patientId: '123' } } as any}
      />,
    );

    expect(getByTestId('patient-name').props.children).toBe('Ana Pérez');
    expect(getByTestId('patient-gender-age').props.children).toBe('Femenino, 30 años');
    const bedChildren = getByTestId('patient-bed').props.children;
    const bedText = Array.isArray(bedChildren) ? bedChildren.join('') : bedChildren;
    expect(bedText).toBe('Cama 7B');
    const mrnChildren = getByTestId('patient-mrn').props.children;
    const mrnText = Array.isArray(mrnChildren) ? mrnChildren.join('') : mrnChildren;
    expect(mrnText).toBe('MRN MRN-7');
  });

  it('indica que no hay paciente vinculado cuando falta patientId', () => {
    mockUsePatientSummary.mockReturnValue({ loading: false, error: null, summary: null });
    mockUseZodForm.mockReturnValue(buildFormMock(''));

    const { getByTestId } = render(
      <HandoverForm navigation={{ navigate: vi.fn() } as any} route={{ key: '2', name: 'HandoverForm', params: {} } as any} />,
    );

    expect(getByTestId('patient-banner-empty-title').props.children).toContain('Paciente no vinculado');
    expect(getByTestId('patient-banner-empty-subtitle').props.children).toContain('Asocia un ID para mostrar el banner.');
  });
});
