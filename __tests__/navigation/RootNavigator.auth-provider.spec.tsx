import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import RootNavigator from '@/src/navigation/RootNavigator';
import { AuthProvider } from '@/src/security/auth';

vi.mock('expo-auth-session', () => ({
  useAutoDiscovery: () => null,
  useAuthRequest: () => [null, null, vi.fn()],
  fetchDiscoveryAsync: vi.fn(async () => ({ tokenEndpoint: 'https://issuer.example/token' })),
  ResponseType: { Code: 'code' },
  AuthRequest: function AuthRequest() {},
  exchangeCodeAsync: vi.fn(),
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: () => {},
  openAuthSessionAsync: vi.fn(async () => ({ type: 'dismiss' })),
}));

vi.mock('@/src/security/secure-storage', () => ({
  secureGetItem: vi.fn(async () => null),
  secureSetItem: vi.fn(async () => undefined),
  secureDeleteItem: vi.fn(async () => undefined),
}));

vi.mock('@/src/lib/fhir-client', () => ({
  configureFHIRClient: vi.fn(),
}));

vi.mock('@/src/screens/PatientList', () => ({
  __esModule: true,
  default: () => <></>,
}));

vi.mock('@/src/screens/LoginScreen', () => ({
  __esModule: true,
  default: () => <>LoginScreenMock</>,
}));

vi.mock('@/src/components/DemoModeBanner', () => ({ DemoModeBanner: () => null }));
vi.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: vi.fn(async () => true),
}));

vi.mock('@/src/screens/AudioNote', () => ({ default: () => <></> }));
vi.mock('@/src/screens/HandoverForm', () => ({ default: () => <></> }));
vi.mock('@/src/screens/PatientDashboard', () => ({ default: () => <></> }));
vi.mock('@/src/screens/OnboardingScreen', () => ({ default: () => <></> }));
vi.mock('@/src/screens/QRScan', () => ({ default: () => <></> }));
vi.mock('@/src/screens/ShiftDetailsScreen', () => ({ default: () => <></> }));
vi.mock('@/src/screens/SyncCenter', () => ({ default: () => <></> }));
vi.mock('@/src/screens/SupervisorDashboard', () => ({ default: () => <></> }));
vi.mock('@/src/screens/admin/AdminDashboardScreen', () => ({ AdminDashboardScreen: () => <></> }));

vi.mock('@/src/security/acl', () => ({ hasRole: () => true }));

describe('RootNavigator with AuthProvider', () => {
  it('muestra Login cuando no hay sesión', async () => {
    const { findByText } = render(
      <AuthProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>,
    );

    await waitFor(async () => {
      expect(await findByText('LoginScreenMock')).toBeTruthy();
    });
  });
});
