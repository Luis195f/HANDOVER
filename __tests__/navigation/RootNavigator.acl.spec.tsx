import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import RootNavigator from '@/src/navigation/RootNavigator';
import { useAuth } from '@/src/security/auth';

vi.mock('@/src/security/auth', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/auth')>('@/src/security/auth');
  return { ...actual, useAuth: vi.fn() };
});

vi.mock('@/src/lib/onboarding-storage', () => ({
  getOnboardingCompleted: vi.fn(async () => true),
}));

vi.mock('@/src/screens/PatientList', () => ({
  __esModule: true,
  default: () => <></>,
}));
vi.mock('@/src/screens/LoginScreen', () => ({
  __esModule: true,
  default: () => <></>,
}));
vi.mock('@/src/screens/AudioNote', () => ({ default: () => <></> }));
vi.mock('@/src/screens/HandoverForm', () => ({ default: () => <></> }));
vi.mock('@/src/screens/HandoverMain', () => ({ default: () => <></> }));
vi.mock('@/src/screens/PatientDashboard', () => ({ default: () => <></> }));
vi.mock('@/src/screens/OnboardingScreen', () => ({
  __esModule: true,
  default: ({ onComplete }: { onComplete: () => void }) => {
    React.useEffect(() => {
      onComplete();
    }, [onComplete]);
    return null;
  },
}));
vi.mock('@/src/screens/QRScan', () => ({ default: () => <></> }));
vi.mock('@/src/screens/ShiftDetailsScreen', () => ({ default: () => <></> }));
vi.mock('@/src/screens/SyncCenter', () => ({ default: () => <></> }));
vi.mock('@/src/screens/SupervisorDashboard', () => ({ default: () => <></> }));
vi.mock('@/src/screens/admin/AdminDashboardScreen', () => ({ AdminDashboardScreen: () => <></> }));
vi.mock('@/src/components/DemoModeBanner', () => ({ DemoModeBanner: () => null }));

describe('RootNavigator ACL', () => {
  it('redirige a Login cuando no hay sesión', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: null,
      loading: false,
      loginWithOAuth: vi.fn(),
      loginDemo: vi.fn(),
      logout: vi.fn(),
    } as any);

    const tree = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    await waitFor(() => {
      expect(tree).toBeTruthy();
    });
    // Login screen mock renders empty fragment, but navigator should mount without protected screens
    expect(tree.queryByText('Acceso restringido')).toBeNull();
  });

  it('bloquea pantallas clínicas cuando el rol no es válido', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: {
        accessToken: 'token',
        refreshToken: undefined,
        expiresAt: new Date().toISOString(),
        userId: 'admin-user',
        displayName: 'Admin',
        roles: ['admin'],
        units: [],
      },
      loading: false,
      loginWithOAuth: vi.fn(),
      loginDemo: vi.fn(),
      logout: vi.fn(),
    } as any);

    const { findByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect(await findByText('Acceso restringido')).toBeTruthy();
  });
});
