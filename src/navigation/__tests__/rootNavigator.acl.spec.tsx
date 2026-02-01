import React from 'react';
import { Text, View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import RootNavigator from '@/src/navigation/RootNavigator';

// =====================================================
// ✅ Hard mocks para React Navigation Native Stack (CI-safe)
// =====================================================

// 1) Mock del NativeStackView (ESM internal path que está rompiendo en CI)
jest.mock('@react-navigation/native-stack/lib/module/views/NativeStackView', () => {
  return {
    __esModule: true,
    default: () => null,
  };
});

// 2) Mock del index module path (por si Vitest resuelve el import así)
jest.mock('@react-navigation/native-stack/lib/module/index.js', () => {
  return {
    __esModule: true,
    createNativeStackNavigator: () => {
      const React = require('react');

      const Screen = (_props: any) => null;

      const Navigator = ({ initialRouteName, children, __TEST_ROUTE }: any) => {
        const routeName = __TEST_ROUTE ?? initialRouteName;
        const screens = React.Children.toArray(children).filter(Boolean);

        const match = screens.find((child: any) => child?.props?.name === routeName) as any;
        if (!match) return null;

        if (match.props.component) {
          const Comp = match.props.component;
          return React.createElement(Comp, { navigation: {}, route: {} });
        }

        if (typeof match.props.children === 'function') {
          return match.props.children({ navigation: {}, route: {} });
        }

        return null;
      };

      return { Screen, Navigator };
    },
  };
});

// 3) Mock principal del paquete
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');

  function createNativeStackNavigator() {
    const Screen = (_props: any) => null;

    const Navigator = ({ initialRouteName, children, __TEST_ROUTE }: any) => {
      const routeName = __TEST_ROUTE ?? initialRouteName;
      const screens = React.Children.toArray(children).filter(Boolean);

      const match = screens.find((child: any) => child?.props?.name === routeName) as any;
      if (!match) return null;

      if (match.props.component) {
        const Comp = match.props.component;
        return React.createElement(Comp, { navigation: {}, route: {} });
      }

      if (typeof match.props.children === 'function') {
        return match.props.children({ navigation: {}, route: {} });
      }

      return null;
    };

    return { Screen, Navigator };
  }

  return { createNativeStackNavigator };
});

// 4) Mock mínimo de @react-navigation/native para no necesitar NavigationContainer real
jest.mock('@react-navigation/native', () => {
  const React = require('react');

  return {
    NavigationContainer: ({ children }: any) => React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: () => undefined,
    }),
  };
});

// =====================================================
// ✅ Mocks: screens (texto estable para asserts)
// =====================================================
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

// Mock del resto para evitar imports laterales
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

// =====================================================
// ✅ Mocks: onboarding/consent
// =====================================================
jest.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: jest.fn(),
}));

jest.mock('@/src/lib/privacy-consent', () => ({
  hasPrivacyConsent: jest.fn(),
}));

// =====================================================
// ✅ Mock: auth hook
// =====================================================
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

    // Remount forzando ruta (prop solo para nuestro mock de Stack.Navigator)
    ui.unmount();
    const ui2 = render(
      // @ts-expect-error test-only prop usado por el mock del Navigator
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

    expect(ui.getByTestId('PATIENT_LIST')).toBeTruthy();
  });

  test('sin roles → Unauthorized', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      loading: false,
      logout: jest.fn(),
      session: {
        mode: 'prod',
        roles: [],
      },
    });

    const ui = render(<RootNavigator />);
    await act(async () => {});

    expect(ui.getByText('Acceso restringido')).toBeTruthy();
  });
});
