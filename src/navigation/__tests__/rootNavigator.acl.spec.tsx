import React from 'react';
import { Button, Text, View } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// ✅ Mocks (ANTES de importar RootNavigator)
// =====================================================

// Mock del paquete público native-stack (evita NativeStackView en CI)
vi.mock('@react-navigation/native-stack', () => {
  const React = require('react');

  function createNativeStackNavigator() {
    const Screen = (_props: any) => null;

    const Navigator = ({ initialRouteName, children }: any) => {
      const forced = (globalThis as any).__TEST_ROUTE;
      const routeName = forced ?? initialRouteName;

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

// Mock mínimo de @react-navigation/native
vi.mock('@react-navigation/native', () => {
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
vi.mock('@/src/screens/PatientList', () => ({
  default: function PatientListMock() {
    return <Text testID="PATIENT_LIST">PATIENT_LIST</Text>;
  },
}));

vi.mock('@/src/screens/SupervisorDashboard', () => ({
  default: function SupervisorDashboardMock() {
    return <Text testID="SUPERVISOR_DASHBOARD">SUPERVISOR_DASHBOARD</Text>;
  },
}));

// Mock del resto para evitar imports laterales
vi.mock('@/src/screens/AudioNote', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/HandoverForm', () => ({
  default: function HandoverFormMock() {
    const [value, setValue] = React.useState('initial-form-state');
    return (
      <View>
        <Text testID="HANDOVER_FORM_STATE">{value}</Text>
        <Button title="Edit form" onPress={() => setValue('retained-form-state')} />
      </View>
    );
  },
}));
vi.mock('@/src/screens/PatientDashboard', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/OnboardingScreen', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/PrivacyPolicy', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/QRScan', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/ShiftDetailsScreen', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/SyncCenter', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/AuditLogScreen', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/LoginScreen', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/PrivacyConsentScreen', () => ({ default: () => <View /> }));
vi.mock('@/src/screens/admin/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => <View />,
}));

vi.mock('@/src/components/DemoModeBanner', () => ({
  DemoModeBanner: () => null,
}));

// =====================================================
// ✅ Mocks: onboarding/consent
// =====================================================
vi.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: vi.fn(),
}));

vi.mock('@/src/lib/privacy-consent', () => ({
  hasPrivacyConsent: vi.fn(),
}));

// =====================================================
// ✅ Mock: auth hook
// =====================================================
vi.mock('@/src/security/auth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/src/security/auth';
import { getOnboardingCompleted } from '@/src/lib/onboarding-storage';
import { hasPrivacyConsent } from '@/src/lib/privacy-consent';

// Import dinámico DESPUÉS de mocks
async function loadRootNavigator() {
  const mod = await import('@/src/navigation/RootNavigator');
  return mod.default;
}

describe('RootNavigator ACL (role enforcement)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (globalThis as any).__TEST_ROUTE = undefined;

    (getOnboardingCompleted as any).mockResolvedValue(true);
    (hasPrivacyConsent as any).mockResolvedValue(true);
  });

  test('admin → puede ver SupervisorDashboard', async () => {
    (useAuth as any).mockReturnValue({
      loading: false,
      logout: vi.fn(),
      session: {
        mode: 'prod',
        roles: ['admin'],
      },
      capabilities: {
        userSub: 'auth0|admin',
        roles: ['admin'],
        scopes: ['handover:write', 'handover:audit'],
        unitIds: [],
        permissions: {
          canWriteHandover: true,
          canReadPatients: true,
          canCreatePatients: true,
          canSignHandover: true,
          canViewAudit: true,
          canSendAuditEvents: true,
          isAdmin: true,
        },
      },
    });

    // Forzamos ruta solo para el mock del Navigator
    (globalThis as any).__TEST_ROUTE = 'SupervisorDashboard';

    const RootNavigator = await loadRootNavigator();
    const ui = render(<RootNavigator />);

    await act(async () => {});

    expect(ui.getByTestId('SUPERVISOR_DASHBOARD')).toBeTruthy();
  });

  test('nurse → puede ver PatientList', async () => {
    (useAuth as any).mockReturnValue({
      loading: false,
      logout: vi.fn(),
      session: {
        mode: 'prod',
        roles: ['nurse'],
      },
      capabilities: {
        userSub: 'auth0|nurse',
        roles: ['nurse'],
        scopes: ['handover:write', 'patients:read'],
        unitIds: ['icu-a'],
        permissions: {
          canWriteHandover: true,
          canReadPatients: true,
          canCreatePatients: true,
          canSignHandover: false,
          canViewAudit: false,
          canSendAuditEvents: true,
          isAdmin: false,
        },
      },
    });

    const RootNavigator = await loadRootNavigator();
    const ui = render(<RootNavigator />);

    await act(async () => {});

    expect(ui.getByTestId('PATIENT_LIST')).toBeTruthy();
  });

  test('sin roles → Unauthorized', async () => {
    (useAuth as any).mockReturnValue({
      loading: false,
      logout: vi.fn(),
      session: {
        mode: 'prod',
        roles: [],
      },
      capabilities: {
        userSub: 'auth0|none',
        roles: [],
        scopes: [],
        unitIds: [],
        permissions: {
          canWriteHandover: false,
          canReadPatients: false,
          canCreatePatients: false,
          canSignHandover: false,
          canViewAudit: false,
          canSendAuditEvents: false,
          isAdmin: false,
        },
      },
    });

    const RootNavigator = await loadRootNavigator();
    const ui = render(<RootNavigator />);

    await act(async () => {});

    expect(ui.getByText('Acceso restringido')).toBeTruthy();
  });

  test('demo actor switch preserves the mounted HandoverForm state', async () => {
    (globalThis as { __TEST_ROUTE?: string }).__TEST_ROUTE = 'HandoverForm';
    const capabilities: NonNullable<ReturnType<typeof useAuth>['capabilities']> = {
      userSub: 'demo@nurseos.app',
      roles: ['nurse'],
      scopes: ['handover:write', 'fhir:transaction'],
      unitIds: [],
      permissions: {
        canWriteHandover: true,
        canReadPatients: true,
        canCreatePatients: true,
        canSignHandover: false,
        canViewAudit: false,
        canSendAuditEvents: false,
        isAdmin: false,
      },
    };
    let authState: ReturnType<typeof useAuth> = {
      loading: false,
      logout: vi.fn(async () => undefined),
      switchDemoActor: async (userId) => ({
        mode: 'demo',
        userId,
        roles: ['nurse'],
        units: [],
        accessToken: 'demo-token',
      }),
      loginWithOAuth: vi.fn(),
      loginWithCredentials: vi.fn(),
      loginDemo: vi.fn(),
      refreshCapabilities: vi.fn(),
      session: {
        mode: 'demo',
        userId: 'demo@nurseos.app',
        roles: ['nurse'],
        units: [],
        accessToken: 'demo-token',
      },
      capabilities,
    };
    vi.mocked(useAuth).mockImplementation(() => authState);

    const RootNavigator = await loadRootNavigator();
    const ui = render(<RootNavigator />);
    await act(async () => {});
    fireEvent.press(ui.getByText('Edit form'));
    expect(ui.getByTestId('HANDOVER_FORM_STATE').props.children).toBe('retained-form-state');

    authState = {
      ...authState,
      session: {
        mode: 'demo',
        userId: 'demo.receiver@nurseos.app',
        roles: ['nurse'],
        units: [],
        accessToken: 'demo-token',
      },
      capabilities: { ...capabilities, userSub: 'demo.receiver@nurseos.app' },
    };
    await act(async () => {
      ui.update(<RootNavigator />);
    });

    expect(ui.getByTestId('HANDOVER_FORM_STATE').props.children).toBe('retained-form-state');
    expect(getOnboardingCompleted).toHaveBeenCalledTimes(1);
    expect(hasPrivacyConsent).toHaveBeenCalledTimes(1);
  });
});
