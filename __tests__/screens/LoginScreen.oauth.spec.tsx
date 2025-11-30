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

describe('LoginScreen OAuth handling', () => {
  beforeEach(() => {
    navigationResetMock.mockReset();
    vi.clearAllMocks();
  });

  it('ignora cancelación de OAuth sin mostrar alerta', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const loginWithOAuth = vi.fn().mockRejectedValue({ type: 'dismiss' });

    vi.mocked(useAuth).mockReturnValue({
      loginDemo: vi.fn(),
      loginWithOAuth,
      session: null,
      loading: false,
      logout: vi.fn(),
    } as any);

    const { getByText } = render(<LoginScreen />);

    fireEvent.press(getByText('Iniciar sesión'));

    await waitFor(() => {
      expect(loginWithOAuth).toHaveBeenCalled();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(navigationResetMock).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('muestra alerta en errores de OAuth distintos a cancelación', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    const loginWithOAuth = vi.fn().mockRejectedValue(new Error('network'));

    vi.mocked(useAuth).mockReturnValue({
      loginDemo: vi.fn(),
      loginWithOAuth,
      session: null,
      loading: false,
      logout: vi.fn(),
    } as any);

    const { getByText } = render(<LoginScreen />);
    fireEvent.press(getByText('Iniciar sesión'));

    await waitFor(() => {
      expect(loginWithOAuth).toHaveBeenCalled();
    });

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
