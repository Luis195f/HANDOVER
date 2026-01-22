import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import LoginScreen from '@/src/screens/LoginScreen';
import { useAuth } from '@/src/security/auth';

const navigationResetMock = vi.fn();

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: navigationResetMock }),
}));

vi.mock('@/src/security/auth', async () => {
  const actual = await vi.importActual<typeof import('@/src/security/auth')>('@/src/security/auth');
  return { ...actual, useAuth: vi.fn() };
});

describe('LoginScreen credentials handling', () => {
  beforeEach(() => {
    navigationResetMock.mockReset();
    vi.clearAllMocks();
  });

  it('muestra alerta cuando las credenciales son inválidas', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const loginWithCredentials = vi.fn().mockRejectedValue(new Error('INVALID_CREDENTIALS'));

    vi.mocked(useAuth).mockReturnValue({
      loginDemo: vi.fn(),
      loginWithCredentials,
      session: null,
      loading: false,
      logout: vi.fn(),
    } as any);

    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByPlaceholderText('Usuario'), 'demo');
    fireEvent.changeText(getByPlaceholderText('Contraseña'), 'bad');
    fireEvent.press(getByText('Iniciar sesión'));

    await waitFor(() => {
      expect(loginWithCredentials).toHaveBeenCalled();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(navigationResetMock).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('navega a la lista de pacientes cuando el login es exitoso', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const loginWithCredentials = vi.fn().mockResolvedValue({});

    vi.mocked(useAuth).mockReturnValue({
      loginDemo: vi.fn(),
      loginWithCredentials,
      session: null,
      loading: false,
      logout: vi.fn(),
    } as any);

    const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    fireEvent.changeText(getByPlaceholderText('Usuario'), 'demo');
    fireEvent.changeText(getByPlaceholderText('Contraseña'), 'demo');
    fireEvent.press(getByText('Iniciar sesión'));

    await waitFor(() => {
      expect(loginWithCredentials).toHaveBeenCalled();
    });

    expect(navigationResetMock).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'PatientList' }],
    });
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
