import React from 'react';
import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const mockUseZodForm = vi.fn();

vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    ...actual,
    Controller: () => null,
  };
});

const buildHandoverBundle = vi.fn();
vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundle: (...args: unknown[]) => buildHandoverBundle(...args),
}));

const enqueueBundle = vi.fn();
vi.mock('@/src/lib/queue', () => ({
  enqueueBundle: (...args: unknown[]) => enqueueBundle(...args),
}));

vi.mock('@/src/components/AudioAttach', () => ({
  default: () => null,
}));

const hasUnitAccess = vi.fn(() => true);
vi.mock('@/src/security/acl', () => ({
  hasUnitAccess: (...args: unknown[]) => hasUnitAccess(...args),
}));

vi.mock('@/src/security/auth', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: 'nurse-1',
      name: 'Nurse Jane',
      roles: ['nurse'],
      allowedUnits: ['icu-west'],
    },
  })),
}));

vi.mock('@/src/state/filterStore', () => ({
  ALL_UNITS_OPTION: 'ALL',
  useSelectedUnitId: () => 'fallback-unit',
}));

vi.mock('@/src/lib/news2', () => ({
  computeNEWS2: () => ({ total: 0, anyThree: false, band: 'low' }),
}));

vi.mock('@/src/config/flags', () => ({
  isOn: () => false,
}));

describe('HandoverForm', () => {
  const navigation = {
    navigate: vi.fn(),
    goBack: vi.fn(),
    getState: vi.fn(() => ({ routeNames: ['QRScan'] })),
  } as any;

  const route = {
    key: 'handover',
    name: 'HandoverForm' as const,
    params: {
      patientId: 'pat-001',
      unitId: 'icu-west',
      specialtyId: 'cardio',
    },
  } as any;

  const baseValues = {
    unitId: 'icu-west',
    start: '2024-01-01T08:00:00Z',
    end: '2024-01-01T12:00:00Z',
    staffIn: 'Nurse In',
    staffOut: 'Nurse Out',
    patientId: 'pat-001',
    meds: 'Paracetamol, Ibuprofeno',
    vitals: { spo2: 95 },
    oxygenTherapy: {},
    sbarSituation: 'Stable',
    sbarBackground: 'Admitted yesterday',
    sbarAssessment: 'Improving',
    sbarRecommendation: 'Continue monitoring',
  } as const;

  const bundleStub = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        request: { method: 'POST', url: 'Observation' },
      },
    ],
  } as const;

  beforeEach(() => {
    buildHandoverBundle.mockReset();
    enqueueBundle.mockReset();
    hasUnitAccess.mockClear();
    mockUseZodForm.mockReset();
    navigation.goBack.mockClear();
    navigation.navigate.mockClear();
    navigation.getState.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('encola el bundle cuando los datos son válidos', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    buildHandoverBundle.mockReturnValue(bundleStub);
    enqueueBundle.mockResolvedValue(undefined);

    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (onValid: any) => () => onValid(baseValues),
      getValues: (field: keyof typeof baseValues) => baseValues[field],
      getFieldState: () => ({ isDirty: false }),
      setValue: vi.fn(),
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    await act(async () => {});

    const submitButton = renderer!.root.findByProps({ title: 'Guardar' });
    await act(async () => {
      submitButton.props.onPress();
    });

    expect(hasUnitAccess).toHaveBeenCalledWith(
      'icu-west',
      expect.objectContaining({
        sub: 'nurse-1',
        role: 'nurse',
        unitIds: expect.arrayContaining(['icu-west']),
      })
    );
    expect(buildHandoverBundle).toHaveBeenCalledTimes(1);
    expect(buildHandoverBundle.mock.calls[0]?.[0]).toMatchObject({
      patientId: 'pat-001',
      medications: [
        { status: 'active', display: 'Paracetamol' },
        { status: 'active', display: 'Ibuprofeno' },
      ],
      sbar: expect.objectContaining({ recommendation: 'Continue monitoring' }),
    });
    expect(enqueueBundle).toHaveBeenCalledWith(bundleStub, {
      patientId: 'pat-001',
      unitId: 'icu-west',
      specialtyId: 'cardio',
    });
    expect(alertSpy).toHaveBeenCalledWith('OK', expect.stringContaining('Entrega encolada'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('muestra alerta de error cuando la validación falla', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: { unitId: { message: 'Unidad requerida' } } },
      handleSubmit: (_onValid: any, onInvalid: any) => () => onInvalid?.(new Error('Datos inválidos')),
      getValues: () => '',
      getFieldState: () => ({ isDirty: false }),
      setValue: vi.fn(),
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<HandoverForm navigation={navigation} route={route} />);
    });

    await act(async () => {});

    const submitButton = renderer!.root.findByProps({ title: 'Guardar' });
    await act(async () => {
      submitButton.props.onPress();
    });

    expect(enqueueBundle).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Datos inválidos');
  });
});
