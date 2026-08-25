import React from 'react';
import { Alert, Button } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  let currentContext: Record<string, unknown> | undefined;
  return {
    ...actual,
    Controller: () => null,
    FormProvider: ({ children, ...ctx }: React.PropsWithChildren<Record<string, unknown>>) => {
      currentContext = {
        register: vi.fn(),
        clearErrors: vi.fn(),
        setFocus: vi.fn(),
        ...ctx,
      };
      return <>{children}</>;
    },
    useFieldArray: () => ({
      fields: [],
      append: vi.fn(),
      remove: vi.fn(),
    }),
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
    useFormContext: () => currentContext,
    useWatch: vi.fn(() => undefined),
  };
});

const enqueueBundle = vi.fn();
const buildHandoverBundleAsync = vi.fn(async () => ({ bundle: true }));
const ensureUnitAccess = vi.fn();
const mockSession = {
  userId: 'nurse-1',
  displayName: 'Nurse One',
  roles: ['nurse'],
  units: ['unit-1'],
  user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1', roles: ['nurse'], units: ['unit-1'] },
};

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: mockSession,
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(),
  }),
  getSession: vi.fn(async () => mockSession),
}));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: (...args: unknown[]) => ensureUnitAccess(...args) }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: (...args: unknown[]) => enqueueBundle(...args) }));
vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundleAsync: (...args: unknown[]) => buildHandoverBundleAsync(...args),
}));

vi.mock('@/src/lib/audit', () => ({
  createAsyncStorageAuditStorage: () => ({ type: 'mock' }),
  appendAuditEvent: vi.fn(),
  makeAuditEvent: vi.fn(),
  queueAndFlushAuditEvent: vi.fn(async () => true),
}));

vi.mock('@/src/lib/stt', () => ({
  createSttService: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    getStatus: () => 'idle',
    getLastError: () => null,
    setListener: vi.fn(),
    addListener: vi.fn(() => () => undefined),
  }),
}));
vi.mock('@/src/screens/components/EliminationSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/FluidBalanceSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/MobilitySkinSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/NutritionSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/PsychosocialSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({
  ExportPdfButton: ({ onBeforeExport }: { onBeforeExport?: () => Promise<boolean> }) => {
    onBeforeExport?.();
    return null;
  },
}));
vi.mock('@/src/components/SignaturePad', () => ({
  SignaturePad: ({
    onChange,
    disabled,
  }: {
    onChange: (value: { imageBase64: string; signedAt: string } | null) => void;
    disabled?: boolean;
  }) => {
    if (disabled) return null;
    return (
      <Button
        title="Capturar firma"
        onPress={() =>
          onChange({ imageBase64: 'mock-signature', signedAt: '2025-01-05T10:30:00.000Z' })
        }
      />
    );
  },
}));

const mockUseZodForm = vi.fn();
let formValues: Record<string, any> = {};
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

describe('HandoverForm signatures', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_E2E;
    enqueueBundle.mockReset();
    buildHandoverBundleAsync.mockReset();
    ensureUnitAccess.mockReset();
    mockSession.roles = ['nurse'];
    mockSession.user.roles = ['nurse'];
    formValues = {
      patientId: 'P1',
      'administrativeData.unit': 'unit-1',
      dxMedical: { system: SNOMED_SYSTEM, code: '', display: '' },
      dxNursing: { system: SNOMED_SYSTEM, code: '', display: '' },
      signatures: {},
      risksStructured: [],
    };
    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (onValid: any, onInvalid?: any) => () => {
        if (formValues.status === 'final' && !formValues.signatures?.outgoing) {
          onInvalid?.({});
          return;
        }
        return onValid(formValues);
      },
      getValues: (field?: string) => (field ? formValues[field] : formValues),
      getFieldState: () => ({ isDirty: false }),
      watch: (field?: string | string[]) => {
        if (Array.isArray(field)) {
          return field.map((key) => formValues[key]);
        }
        if (!field) {
          return formValues;
        }
        return formValues[field];
      },
      trigger: vi.fn(async () => true),
      setValue: (field: string, value: unknown) => {
        formValues[field] = value;
      },
    });
  });

  it('permite que una enfermera saliente firme', async () => {
    formValues.status = 'final';

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '1', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    await waitFor(() => {
      expect(getByText('Capturar firma')).toBeTruthy();
    });
    fireEvent.press(getByText('Capturar firma'));

    await waitFor(() => {
      expect(formValues.signatures?.outgoing?.imageBase64).toBe('mock-signature');
    });
  });

  it('no muestra botón de firma para roles no autorizados', () => {
    mockSession.roles = ['admin'];
    mockSession.user.roles = ['admin'];
    const { queryByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '2', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    expect(queryByText('Capturar firma')).toBeNull();
  });

  it('bloquea finalización sin firma saliente', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => 0);

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '3', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    formValues.bedsideChecklist = {
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: true,
      medicationPlanReviewed: true,
      safetyMeasuresApplied: true,
      questionsAnswered: true,
    };

    fireEvent.press(getByText('Finalizar entrega'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Falta atestación',
        'Para finalizar la entrega falta la atestación y la evidencia local de la enfermera saliente.',
      );
    });
    expect(buildHandoverBundleAsync).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('ignora HANDOVER_SIGNATURE_DISABLED y mantiene la firma obligatoria', async () => {
    const originalFlag = process.env.HANDOVER_SIGNATURE_DISABLED;
    process.env.HANDOVER_SIGNATURE_DISABLED = 'true';
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => 0);

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '4', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    formValues.bedsideChecklist = {
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: true,
      medicationPlanReviewed: true,
      safetyMeasuresApplied: true,
      questionsAnswered: true,
    };

    fireEvent.press(getByText('Finalizar entrega'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Falta atestación',
        'Para finalizar la entrega falta la atestación y la evidencia local de la enfermera saliente.',
      );
    });
    expect(buildHandoverBundleAsync).not.toHaveBeenCalled();

    alertSpy.mockRestore();
    if (originalFlag === undefined) {
      delete process.env.HANDOVER_SIGNATURE_DISABLED;
    } else {
      process.env.HANDOVER_SIGNATURE_DISABLED = originalFlag;
    }
  });

  it('no expone controles E2E que escriban directamente firma, estado o checklist', () => {
    const originalE2E = process.env.EXPO_PUBLIC_E2E;
    process.env.EXPO_PUBLIC_E2E = 'true';

    const { queryByTestId } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '5', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    expect(queryByTestId('e2e-set-final')).toBeNull();
    expect(queryByTestId('e2e-add-signature')).toBeNull();
    expect(queryByTestId('e2e-complete-checklist')).toBeNull();

    if (originalE2E === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = originalE2E;
    }
  });

  it('bloquea finalización sin atestación entrante', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => 0);

    formValues.status = 'final';
    formValues.bedsideChecklist = {
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: true,
      medicationPlanReviewed: true,
      safetyMeasuresApplied: true,
      questionsAnswered: true,
    };

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '6', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    await waitFor(() => {
      expect(getByText('Capturar firma')).toBeTruthy();
    });
    fireEvent.press(getByText('Capturar firma'));
    fireEvent.press(getByText('Finalizar entrega'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Falta atestación',
        'Para finalizar la entrega falta la atestación autenticada de la enfermera entrante.',
      );
    });

    alertSpy.mockRestore();
  });

  it('rechaza doble atestación con el mismo actor', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => 0);

    formValues.status = 'final';
    formValues.bedsideChecklist = {
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: true,
      medicationPlanReviewed: true,
      safetyMeasuresApplied: true,
      questionsAnswered: true,
    };

    const { getByText } = render(
      <HandoverForm
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: '7', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any}
      />,
    );

    await waitFor(() => {
      expect(getByText('Capturar firma')).toBeTruthy();
    });

    fireEvent.press(getByText('Capturar firma'));
    formValues.signatures = {
      ...formValues.signatures,
      incoming: {
        userId: 'nurse-1',
        fullName: 'Nurse One',
        unitId: 'unit-1',
        signedAt: '2025-01-05T10:35:00.000Z',
        method: 'session',
      },
    };
    fireEvent.press(getByText('Finalizar entrega'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Falta atestación',
        'La doble atestación del relevo requiere profesionales distintos.',
      );
    });

    alertSpy.mockRestore();
  });
});
