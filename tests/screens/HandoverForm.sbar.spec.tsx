import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import type { HandoverValues } from '@/src/types/handover';

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    ...actual,
    FormProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Controller: ({ render }: { render: ({ field }: { field: any }) => React.ReactNode }) =>
      render({ field: { onChange: vi.fn(), onBlur: vi.fn(), value: '' } }),
    useFieldArray: () => ({ fields: [], append: vi.fn(), remove: vi.fn() }),
  };
});

const mockUseZodForm = vi.fn();
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
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

vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/config/flags', () => ({ isOn: () => true }));
vi.mock('@/src/security/auth', () => ({ getSession: vi.fn(async () => null) }));
vi.mock('@/src/security/acl', () => ({ currentUser: () => null, hasUnitAccess: () => true }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: vi.fn() }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn(async () => undefined) }));

const baseValues: HandoverValues = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    incidents: [],
  },
  patientId: 'P-10',
  dxMedical: 'Neumonía bilateral',
  evolution: 'Estable con oxígeno nasal',
  closingSummary: '',
};

describe('HandoverForm SBAR integration', () => {
  const navigation: any = { navigate: vi.fn(), getState: vi.fn(() => ({ routeNames: [] })), goBack: vi.fn() };
  const route: any = { key: 'test', name: 'HandoverForm', params: {} };
  let alertSpy: ReturnType<typeof vi.spyOn>;
  const trigger = vi.fn(async () => true);
  const setValue = vi.fn();

  beforeEach(() => {
    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (fn: any) => fn,
      trigger,
      getValues: () => baseValues,
      setValue,
      getFieldState: () => ({ isDirty: false }),
    });
    alertSpy = vi.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el botón de generar SBAR e inserta el texto en el cierre', async () => {
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    const buttons = renderer!.root.findAllByType(require('react-native').Button);
    const generateButton = buttons.find((btn) => btn.props.title === 'Generar SBAR');
    expect(generateButton).toBeDefined();

    await act(async () => {
      await generateButton!.props.onPress();
    });

    const insertButton = renderer!.root.findAllByType(require('react-native').Button).find((btn) =>
      btn.props.title === 'Insertar en resumen'
    );
    expect(insertButton).toBeDefined();

    await act(async () => {
      insertButton!.props.onPress();
    });

    expect(setValue).toHaveBeenCalledWith(
      'closingSummary',
      expect.stringContaining('S:'),
      expect.objectContaining({ shouldDirty: true, shouldValidate: true })
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('solicita confirmación cuando ya existe un resumen previo', async () => {
    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (fn: any) => fn,
      trigger,
      getValues: () => ({ ...baseValues, closingSummary: 'Texto previo' }),
      setValue,
      getFieldState: () => ({ isDirty: false }),
    });

    alertSpy = vi
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation((_title: string, _msg?: string, buttons?: any[]) => {
        const confirm = buttons?.find((btn) => btn.style !== 'cancel');
        confirm?.onPress?.();
      });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    const generateButton = renderer!.root.findAllByType(require('react-native').Button).find((btn) =>
      btn.props.title === 'Generar SBAR'
    );

    await act(async () => {
      await generateButton!.props.onPress();
    });

    const insertButton = renderer!.root.findAllByType(require('react-native').Button).find((btn) =>
      btn.props.title === 'Insertar en resumen'
    );

    await act(async () => {
      insertButton!.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith(
      'closingSummary',
      expect.stringContaining('S:'),
      expect.objectContaining({ shouldDirty: true, shouldValidate: true })
    );
  });
});
