import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const buildHandoverBundleMock = vi.fn();
const enqueueBundleMock = vi.fn();
const hasUnitAccessMock = vi.fn(() => true);
const getSessionMock = vi.fn(async () => ({
  user: { id: 'nurse-1', name: 'Nurse Jane' },
}));

vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundle: (...args: unknown[]) => buildHandoverBundleMock(...args),
}));

vi.mock('@/src/lib/queue', () => ({
  enqueueBundle: (...args: unknown[]) => enqueueBundleMock(...args),
}));

vi.mock('@/src/security/acl', () => ({
  hasUnitAccess: (...args: unknown[]) => hasUnitAccessMock(...args),
}));

vi.mock('@/src/security/auth', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock('@/src/state/filterStore', () => ({
  ALL_UNITS_OPTION: 'ALL',
  useSelectedUnitId: () => 'unit-store',
}));

vi.mock('@/src/components/AudioAttach', () => ({
  default: () => null,
}));

vi.mock('@/src/config/flags', () => ({
  isOn: (flag: string) => flag === 'SHOW_MEDS',
}));

vi.mock('@/src/lib/news2', () => ({
  computeNEWS2: () => ({ total: 0, anyThree: false, band: 'low' }),
}));

describe('HandoverForm', () => {
  beforeEach(() => {
    buildHandoverBundleMock.mockReset();
    enqueueBundleMock.mockReset();
    hasUnitAccessMock.mockReturnValue(true).mockClear();
    getSessionMock.mockClear();
    vi.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderForm = () => {
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
    } as const;

    const view = render(<HandoverForm navigation={navigation} route={route} />);

    return { view, navigation };
  };

  it('envía bundle FHIR al hacer submit con datos válidos', async () => {
    const bundle = { resourceType: 'Bundle', type: 'transaction' } as const;
    buildHandoverBundleMock.mockReturnValue(bundle);
    enqueueBundleMock.mockResolvedValue(undefined);

    const { navigation } = renderForm();

    fireEvent.changeText(screen.getByPlaceholderText('Unidad'), 'icu-west');
    fireEvent.changeText(screen.getByPlaceholderText('Inicio (ISO)'), '2024-01-01T08:00:00Z');
    fireEvent.changeText(screen.getByPlaceholderText('Fin (ISO)'), '2024-01-01T12:00:00Z');
    fireEvent.changeText(screen.getByPlaceholderText('Paciente'), 'pat-001');
    fireEvent.changeText(
      screen.getByPlaceholderText('Paracetamol 1g, Omeprazol 20mg'),
      'Paracetamol, Ibuprofeno',
    );

    fireEvent.press(screen.getByText(/Guardar/i));

    await waitFor(() => {
      expect(enqueueBundleMock).toHaveBeenCalledWith(bundle, {
        patientId: 'pat-001',
        unitId: 'icu-west',
        specialtyId: 'cardio',
      });
    });

    expect(buildHandoverBundleMock).toHaveBeenCalled();
    expect(hasUnitAccessMock).toHaveBeenCalledWith('icu-west', expect.anything());
    expect(Alert.alert).toHaveBeenCalledWith('OK', expect.stringContaining('Entrega encolada'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
