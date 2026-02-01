import React from 'react';
import { Text, View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import RootNavigator from '@/src/navigation/RootNavigator';

// --------------------
// Mock: react-navigation (evita dependencias nativas en CI)
// --------------------
jest.mock('@react-navigation/native', () => {
  const React = require('react');

  // navRef simple para navegar sin native stack real
  const refObj: any = {
    current: null,
    isReady: () => true,
    navigate: (_name: string) => {
      /* no-op: lo manejamos con estado mock del Stack */
    },
  };

  return {
    NavigationContainer: ({ children }: any) => React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => refObj,
  };
});

jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');

  // Stack minimalista:
  // - Guarda "name" + "component" o "children render function"
  // - Renderiza SOLO initialRouteName (suficiente para nuestros tests)
  // - Expone un modo simple de "cambiar" de screen vía prop __TEST_ROUTE (solo para tests)
  function createNativeStackNavigator() {
    const Screen = (_props: any) => null;

    const Navigator = ({ initialRouteName, children, __TEST_ROUTE }: any) => {
      const routeName = __TEST_ROUTE ?? initialRouteName;
      const screens = React.Children.toArray(children).filter(Boolean);

      const match = screens.find((child: any) => child?.props?.name === routeName) as any;
      if (!match) return null;

      // Caso 1: component={Comp}
      if (match.props.component) {
        const Comp = match.props.component;
        return React.createElement(Comp, { navigation: {}, route: {} });
      }

      // Caso 2: children render function
      if (typeof match.props.children === 'function') {
        return match.props.children({ navigation: {}, route: {} });
      }

      return null;
    };

    return { Screen, Navigator };
  }

  return { createNativeStackNavigator };
});

// --------------------
// Mocks: screens (texto estable para asserts)
// --------------------
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

// ⚠️ RootNavigator registra muchas screens.
// Para que NO fallen imports innecesarios, mockeamos el resto con placeholders.
jest.mock('@/src/screens/AudioNote', () => () => <View />);
jest.mock('@/src/screens/HandoverForm', () => () => <View />);
jest.mock('@/src/screens/PatientDashboard', () => () => <View />);
jest.mock('@/src/screens/OnboardingScreen', () => () => <View />);
jest.mock('@/src/screens/PrivacyPolicy', () => () => <View />);
jest.mock('@/src/screens/QRScan', () => () => <View />);
jest.mock('@/src/screens/ShiftDetailsScreen', () => () => <View />);
jest.mock('@/src/screens/SyncCenter', () => () => <View />);
jest.mock('@/src/screens/AuditLogScreen', () => () => <View />);
jest.mock('@/src/screens/LoginScreen', () => () => <View />);
jest.mock('@/src/screens/PrivacyConsentScreen', () => () => <View />);
jest.mock('@/src/screens/admin/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => <View />,
}));

jest.mock('@/src/components/DemoModeBanner', () => ({
  DemoModeBanner: () => null,
}));

// --------------------
// Mocks: onboarding/consent
// --------------------
jest.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: jest.fn(),
}));

jest.mock('@/src/lib/privacy-consent', () => ({
  hasPrivacyConsent: jest.fn(),
}));

// --------------------
// Mock: auth hook
// --------------------
jest.mock('@/src/security/auth', () => ({
  useAuth: jest.fn(),
}));

import { useAuth } from '@/src/security/auth';
import { getOnboardingCompleted } from '@/src/lib/onboarding-storage';
import { hasPrivacyConsent } from '@/src/lib/privacy-consent';

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

    const ui = render(<RootNavigator />);

    await act(async () => {});

    // Como nuestro mock Navigator renderiza initialRouteName, forzamos la ruta con remount:
    // (esto sustituye el "navigate" real, evitando dependencias nativas).
    ui.unmount();
    const ui2 = render(
      // @ts-expect-error prop solo en mock de tests
      <RootNavigator __TEST_ROUTE="SupervisorDashboard" />
    );

    expect(ui2.getByTestId('SUPERVISOR_DASHBOARD')).toBeTruthy();
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

    const ui = render(<RootNavigator />);
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

    const ui = render(<RootNavigator />);
    await act(async () => {});

    // Tu UnauthorizedScreen muestra este título
    expect(ui.getByText('Acceso restringido')).toBeTruthy();
  });
});
