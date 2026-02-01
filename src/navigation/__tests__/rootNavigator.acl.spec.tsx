import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';

import RootNavigator from '@/src/navigation/RootNavigator';

// ---------- Mocks: screens (texto estable para asserts) ----------
jest.mock('@/src/screens/PatientList', () => {
  return function PatientListMock() {
    return <Text testID="PATIENT_LIST">PATIENT_LIST</Text>;
  };
});

jest.mock('@/src/screens/SupervisorDashboard', () => {
  return function SupervisorDashboardMock() {
    return <Text testID="SUPERVISOR_DASHBOARD">SUPERVISOR_DASHBOARD</Text>;
  };
});

// El resto de screens no son necesarios en estos tests; evitamos mocks extra.

// ---------- Mocks: onboarding/consent ----------
jest.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: jest.fn(),
}));

jest.mock('@/src/lib/privacy-consent', () => ({
  hasPrivacyConsent: jest.fn(),
}));

// ---------- Mock: auth hook ----------
jest.mock('@/src/security/auth', () => ({
  useAuth: jest.fn(),
}));

import { useAuth } from '@/src/security/auth';
import { getOnboardingCompleted } from '@/src/lib/onboarding-storage';
import { hasPrivacyConsent } from '@/src/lib/privacy-consent';

const navRef = createNavigationContainerRef<any>();

function renderWithNav() {
  return render(
    <NavigationContainer ref={navRef}>
      <RootNavigator />
    </NavigationContainer>
  );
}

describe('RootNavigator ACL (role enforcement)', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    (getOnboardingCompleted as jest.Mock).mockResolvedValue(true);
    (hasPrivacyConsent as jest.Mock).mockResolvedValue(true);
  });

  test('admin → puede ver SupervisorDashboard', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      loading: false,
      logout: jest.fn(),
      session: {
        mode: 'prod',
        roles: ['admin'],
      },
    });

    const ui = renderWithNav();

    // Espera a que promesas de onboarding/consent resuelvan
    await act(async () => {});

    // Navega explícitamente al dashboard supervisor (lo importante es que el guard lo permita)
    await act(async () => {
      if (navRef.isReady()) {
        navRef.navigate('SupervisorDashboard');
      }
    });

    expect(ui.getByTestId('SUPERVISOR_DASHBOARD')).toBeTruthy();
  });

  test('nurse → puede ver PatientList', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      loading: false,
      logout: jest.fn(),
      session: {
        mode: 'prod',
        roles: ['nurse'],
      },
    });

    const ui = renderWithNav();
    await act(async () => {});

    // Post-onboarding route debería llevar a PatientList
    expect(ui.getByTestId('PATIENT_LIST')).toBeTruthy();
  });

  test('sin roles → Unauthorized', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      loading: false,
      logout: jest.fn(),
      session: {
        mode: 'prod',
        roles: [], // sin roles válidos
      },
    });

    const ui = renderWithNav();
    await act(async () => {});

    // Tu UnauthorizedScreen muestra este título
    expect(ui.getByText('Acceso restringido')).toBeTruthy();
  });
});
