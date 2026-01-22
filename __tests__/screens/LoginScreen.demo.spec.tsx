import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import LoginScreen from '@/src/screens/LoginScreen';
import { useAuth } from '@/src/security/auth';

const navigationResetMock = vi.fn();
const loginDemoMock = vi.fn().mockResolvedValue({});
const loginWithCredentialsMock = vi.fn().mockResolvedValue({});

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: navigationResetMock }),
}));

vi.mock('@/src/security/auth', () => ({
  useAuth: vi.fn(),
}));

describe('LoginScreen demo mode', () => {
  it('permite iniciar modo demo y navegar a la lista de pacientes', async () => {
    vi.mocked(useAuth).mockReturnValue({
      loginDemo: loginDemoMock,
      loginWithCredentials: loginWithCredentialsMock,
      session: null,
      loading: false,
      logout: vi.fn(),
    } as any);

    const { getByText } = render(<LoginScreen />);

    fireEvent.press(getByText('Iniciar demo'));

    await waitFor(() => {
      expect(loginDemoMock).toHaveBeenCalled();
      expect(navigationResetMock).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'PatientList' }],
      });
    });
  });
});
