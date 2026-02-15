import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react-native';

import LoginScreen from '@/src/screens/LoginScreen';

vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    loginWithCredentials: vi.fn(async () => undefined),
    loginDemo: vi.fn(async () => undefined),
    loginWithOAuth: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/src/lib/netinfo', () => ({
  useNetInfo: () => ({ isConnected: true }),
}));

vi.mock('@/src/lib/fast-validate', () => ({
  hasNetwork: () => true,
}));

vi.mock('@/src/theme', () => ({
  useThemeTokens: () => ({
    colors: {
      background: '#fff',
      text: '#000',
      muted: '#666',
      border: '#ddd',
      surface: '#f5f5f5',
      danger: '#d00',
      primary: '#06f',
      onPrimary: '#fff',
      warning: '#f90',
    },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
    radius: { sm: 4 },
    fontSizes: { sm: 12 },
  }),
}));

vi.mock('@/src/i18n', () => ({
  t: (key: string) => key,
}));

describe('LoginScreen demo gate', () => {
  const originalDev = (globalThis as any).__DEV__;
  const originalDemoFlag = process.env.EXPO_PUBLIC_ENABLE_DEMO;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    (globalThis as any).__DEV__ = originalDev;
    process.env.EXPO_PUBLIC_ENABLE_DEMO = originalDemoFlag;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('oculta demo en production sin EXPO_PUBLIC_ENABLE_DEMO', () => {
    (globalThis as any).__DEV__ = false;
    process.env.NODE_ENV = 'production';
    delete process.env.EXPO_PUBLIC_ENABLE_DEMO;

    const ui = render(<LoginScreen />);

    expect(ui.queryByTestId('login-demo')).toBeNull();
  });


  it('no habilita demo con flag falso', () => {
    (globalThis as any).__DEV__ = false;
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_ENABLE_DEMO = 'false';

    const ui = render(<LoginScreen />);

    expect(ui.queryByTestId('login-demo')).toBeNull();
  });

  it('muestra demo con EXPO_PUBLIC_ENABLE_DEMO', () => {
    (globalThis as any).__DEV__ = false;
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_ENABLE_DEMO = '1';

    const ui = render(<LoginScreen />);

    expect(ui.getByTestId('login-demo')).toBeTruthy();
  });
});
