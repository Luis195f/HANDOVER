import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OnboardingScreen from '@/src/screens/OnboardingScreen';
import RootNavigator from '@/src/navigation/RootNavigator';
import { getOnboardingCompleted, setOnboardingCompleted } from '@/src/lib/onboarding-storage';
import { useAuth } from '@/src/security/auth';

vi.mock('@/src/lib/onboarding-storage', () => ({
  setOnboardingCompleted: vi.fn(),
  getOnboardingCompleted: vi.fn(),
}));

vi.mock('@/src/security/auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/src/screens/PatientList', () => ({
  __esModule: true,
  default: () => <Text>PatientListMock</Text>,
}));
vi.mock('@/src/screens/AudioNote', () => ({ default: () => <Text>AudioNoteMock</Text> }));
vi.mock('@/src/screens/HandoverMain', () => ({ default: () => <Text>HandoverMainMock</Text> }));
vi.mock('@/src/screens/HandoverForm', () => ({ default: () => <Text>HandoverFormMock</Text> }));
vi.mock('@/src/screens/ShiftDetailsScreen', () => ({ default: () => <Text>ShiftDetailsMock</Text> }));
vi.mock('@/src/screens/QRScan', () => ({ default: () => <Text>QRScanMock</Text> }));
vi.mock('@/src/screens/SyncCenter', () => ({ default: () => <Text>SyncCenterMock</Text> }));
vi.mock('@/src/screens/PatientDashboard', () => ({ default: () => <Text>PatientDashboardMock</Text> }));
vi.mock('@/src/screens/SupervisorDashboard', () => ({ default: () => <Text>SupervisorDashboardMock</Text> }));
vi.mock('@/src/screens/admin/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => <Text>AdminDashboardMock</Text>,
}));
vi.mock('@/src/screens/LoginScreen', () => ({ default: () => <Text>LoginMock</Text> }));

const navigationMock = {
  reset: vi.fn(),
  navigate: vi.fn(),
} as unknown as any;

afterEach(() => {
  vi.clearAllMocks();
});

describe('OnboardingScreen', () => {
  it('muestra el primer paso al renderizar', () => {
    const { getByText } = render(
      <OnboardingScreen navigation={navigationMock} route={{ key: 'onboarding', name: 'Onboarding' }} />,
    );

    expect(getByText('Bienvenida a HANDOVER-Pro')).toBeTruthy();
  });

  it('avanza al siguiente paso al pulsar Siguiente', () => {
    const { getByText } = render(
      <OnboardingScreen navigation={navigationMock} route={{ key: 'onboarding', name: 'Onboarding' }} />,
    );

    fireEvent.press(getByText('Siguiente'));

    expect(getByText('Formulario estructurado')).toBeTruthy();
  });

  it('marca onboarding como completado al pulsar Entendido', async () => {
    const setCompletedMock = vi.mocked(setOnboardingCompleted);
    const { getByText } = render(
      <OnboardingScreen navigation={navigationMock} route={{ key: 'onboarding', name: 'Onboarding' }} />,
    );

    for (let i = 0; i < 4; i += 1) {
      fireEvent.press(getByText(/Siguiente|Entendido/));
    }

    fireEvent.press(getByText('Entendido'));

    await waitFor(() => {
      expect(setCompletedMock).toHaveBeenCalledWith(true);
      expect(navigationMock.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'PatientList' }] });
    });
  });

  it('permite saltar el onboarding desde el primer paso', async () => {
    const setCompletedMock = vi.mocked(setOnboardingCompleted);
    const { getByText } = render(
      <OnboardingScreen navigation={navigationMock} route={{ key: 'onboarding', name: 'Onboarding' }} />,
    );

    fireEvent.press(getByText('Saltar'));

    await waitFor(() => {
      expect(setCompletedMock).toHaveBeenCalledWith(true);
      expect(navigationMock.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'PatientList' }] });
    });
  });
});

describe('RootNavigator onboarding gate', () => {
  it('muestra onboarding cuando no está completado', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: { roles: ['nurse'] }, loading: false } as any);
    vi.mocked(getOnboardingCompleted).mockResolvedValue(false);

    const { findByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect(await findByText('Bienvenida a HANDOVER-Pro')).toBeTruthy();
  });

  it('muestra la navegación principal cuando el onboarding está completado', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: { roles: ['nurse'] }, loading: false } as any);
    vi.mocked(getOnboardingCompleted).mockResolvedValue(true);

    const { findByText, queryByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    await waitFor(async () => {
      expect(await findByText('PatientListMock')).toBeTruthy();
    });
    expect(queryByText('Bienvenida a HANDOVER-Pro')).toBeNull();
  });
});
