import React from 'react';
import { Alert, Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

vi.mock('@react-navigation/native', async () => {
  const actual = await vi.importActual<typeof import('@react-navigation/native')>(
    '@react-navigation/native',
  );
  return {
    ...actual,
    useIsFocused: () => true,
  };
});

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

    const { getByText, queryByTestId } = render(
      <QRScanScreen navigation={{ navigate } as any} route={{ key: 'qr', name: 'QRScan', params: {} } as any} />,
    );

    expect(getByText('Necesitamos acceso a la cámara para escanear el código QR del paciente.')).toBeTruthy();
    expect(queryByTestId('camera')).toBeNull();
  });

  it('procesa un QR válido y navega al formulario', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);

    const { getByTestId, getByText } = render(
      <QRScanScreen
        navigation={{ navigate } as any}
        route={{ key: 'qr', name: 'QRScan', params: { unitIdParam: 'U1', specialtyId: 'cardio' } } as any}
      />,
    );

    fireEvent.press(getByTestId('camera'));

    await waitFor(() => {
      expect(getByText('Continuar con entrega')).toBeTruthy();
    });

    fireEvent.press(getByText('Continuar con entrega'));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
        patientId: 'Patient/123',
        unitId: 'U1',
        specialtyId: 'cardio',
      }));
    });
    expect(prefillFromFHIR).toHaveBeenCalledWith('Patient/123', expect.any(Object));
  });

  it('bloquea el avance cuando el paciente escaneado no coincide con el activo', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);
    nextScanPayload = { data: 'Patient/999' };

    const { getByTestId, getByText, queryByText } = render(
      <QRScanScreen
        navigation={{ navigate } as any}
        route={{
          key: 'qr',
          name: 'QRScan',
          params: { patientIdParam: 'Patient/123', unitIdParam: 'U1' },
        } as any}
      />,
    );

    fireEvent.press(getByTestId('camera'));

    await waitFor(() => {
      expect(getByText('El paciente escaneado no coincide')).toBeTruthy();
    });

    fireEvent.press(getByText('Continuar con entrega'));
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.press(getByText('Cambiar al paciente escaneado'));

    await waitFor(() => {
      expect(queryByText('El paciente escaneado no coincide')).toBeNull();
    });

    await waitFor(() => {
      expect(queryByText('Precargando datos FHIR…')).toBeNull();
    });

    fireEvent.press(getByText('Continuar con entrega'));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
        patientId: 'Patient/999',
        unitId: 'U1',
      }));
    });
  });

  it('avisa cuando el QR es vacío o inválido', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, vi.fn()]);
    nextScanPayload = { data: '   ' };

    const { getByTestId } = render(
      <QRScanScreen navigation={{ navigate } as any} route={{ key: 'qr', name: 'QRScan', params: {} } as any} />,
    );

    fireEvent.press(getByTestId('camera'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Código no válido', 'No se pudo leer el código QR.');
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
