import React from 'react';
import { Alert, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QRScanScreen from '@/src/screens/QRScan';
import { prefillFromFHIR } from '@/src/lib/prefill';

const navigate = vi.fn();
const mockUseCameraPermissions = vi.fn();
let nextScanPayload: { data?: string } = { data: 'Patient/123' };

vi.mock('expo-camera', () => {
  const CameraView = ({ onBarcodeScanned }: any) => (
    <Text testID="camera" onPress={() => onBarcodeScanned?.(nextScanPayload)}>
      camera-mock
    </Text>
  );
  return {
    CameraView,
    useCameraPermissions: (...args: unknown[]) => mockUseCameraPermissions(...args),
  };
});

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: '123' } }),
}));

vi.mock('@/src/lib/prefill', () => ({
  prefillFromFHIR: vi.fn(async () => ({ vitals: { tempC: 36 } })),
}));

vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({ session: { accessToken: 'token' } }),
}));

vi.mock('@/src/screens/components/PatientBanner', () => ({
  PatientBanner: () => <Text testID="patient-banner">banner</Text>,
}));

beforeEach(() => {
  navigate.mockReset();
  mockUseCameraPermissions.mockReset();
  nextScanPayload = { data: 'Patient/123' };
});

describe('QRScan screen', () => {
  it('muestra mensaje cuando faltan permisos de cámara', () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false }, vi.fn()]);

    const { getByText, queryByText } = render(
      <QRScanScreen navigation={{ navigate } as any} route={{ key: 'qr', name: 'QRScan', params: {} } as any} />,
    );

    expect(getByText(/cámara/i)).toBeTruthy();
    expect(queryByText('camera-mock')).toBeNull();
  });

  it('procesa un QR válido y navega al formulario', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);

    const { getByText } = render(
      <QRScanScreen
        navigation={{ navigate } as any}
        route={{ key: 'qr', name: 'QRScan', params: { unitIdParam: 'U1', specialtyId: 'cardio' } } as any}
      />,
    );

    await act(async () => {
      fireEvent.press(getByText('camera-mock'));
    });

    expect(getByText('Continuar con entrega')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Continuar con entrega'));
    });

    expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
      patientId: '123',
      unitId: 'U1',
      specialtyId: 'cardio',
    }));
    expect(prefillFromFHIR).toHaveBeenCalledWith('123', expect.any(Object));
  });

  it('no marca desajuste si el mismo paciente llega en distintos formatos', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);
    nextScanPayload = { data: '123' };

    const { getByText, queryByText } = render(
      <QRScanScreen
        navigation={{ navigate } as any}
        route={{
          key: 'qr',
          name: 'QRScan',
          params: { patientIdParam: 'Patient/123', unitIdParam: 'U1' },
        } as any}
      />,
    );

    await act(async () => {
      fireEvent.press(getByText('camera-mock'));
    });
    expect(getByText('Continuar con entrega')).toBeTruthy();
    expect(queryByText('El paciente escaneado no coincide')).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('Continuar con entrega'));
    });

    expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
      patientId: '123',
      unitId: 'U1',
    }));
  });

  it('bloquea el avance cuando el paciente escaneado no coincide con el activo', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);
    nextScanPayload = { data: '999' };

    const { getByText, queryByText } = render(
      <QRScanScreen
        navigation={{ navigate } as any}
        route={{
          key: 'qr',
          name: 'QRScan',
          params: { patientIdParam: 'Patient/123', unitIdParam: 'U1' },
        } as any}
      />,
    );

    await act(async () => {
      fireEvent.press(getByText('camera-mock'));
    });

    expect(getByText('El paciente escaneado no coincide')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Continuar con entrega'));
    });
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByText('Cambiar al paciente escaneado'));
    });

    expect(queryByText('El paciente escaneado no coincide')).toBeNull();
    expect(queryByText('Precargando datos FHIR…')).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('Continuar con entrega'));
    });

    expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
      patientId: '999',
      unitId: 'U1',
    }));
  });

  it('avisa cuando el QR es vacío o inválido', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);
    nextScanPayload = { data: '   ' };

    const { getByText } = render(
      <QRScanScreen navigation={{ navigate } as any} route={{ key: 'qr', name: 'QRScan', params: {} } as any} />,
    );

    await act(async () => {
      fireEvent.press(getByText('camera-mock'));
    });
    expect(alertSpy).toHaveBeenCalledWith('Código no válido', 'No se pudo leer el código QR.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('no muestra mismatch cuando no hay paciente activo y se escanea el primero', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);

    const { queryByText, getByText } = render(
      <QRScanScreen navigation={{ navigate } as any} route={{ key: 'qr', name: 'QRScan', params: {} } as any} />,
    );

    await act(async () => {
      fireEvent.press(getByText('camera-mock'));
    });

    expect(getByText('Continuar con entrega')).toBeTruthy();

    expect(queryByText('El paciente escaneado no coincide')).toBeNull();
  });
});
