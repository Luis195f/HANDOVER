// @ts-nocheck
// FILE: src/theme/index.tsx
import React from 'react';
import { useColorScheme, ColorSchemeName, Pressable, Text } from 'react-native';
import {
  DarkTheme as NavDark,
  DefaultTheme as NavLight,
  Theme as NavTheme,
} from '@react-navigation/native';

type Mode = 'system' | 'light' | 'dark';

type Ctx = {
  mode: Mode;
  setMode: (m: Mode) => void;
  isDark: boolean;
  navTheme: NavTheme;
};

const ThemeCtx = React.createContext<Ctx | null>(null);

function makeTheme(isDark: boolean): NavTheme {
  const base = isDark ? NavDark : NavLight;
  return {
    ...base,
    colors: {
      ...base.colors,
      // Ajustes suaves para mantener contraste bueno con tus pantallas
      primary: isDark ? '#82B1FF' : '#2962FF',
      card: isDark ? '#1E1E1E' : '#FFFFFF',
      border: isDark ? '#2F2F2F' : '#E5E5E5',
      text: isDark ? '#ECECEC' : '#111111',
      background: isDark ? '#121212' : '#FFFFFF',
    },
  };
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const system: ColorSchemeName = useColorScheme();
  const [mode, setMode] = React.useState<Mode>('system');

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const navTheme = React.useMemo(() => makeTheme(isDark), [isDark]);

  const value = React.useMemo<Ctx>(() => ({ mode, setMode, isDark, navTheme }), [mode, isDark, navTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useAppTheme() {
  const ctx = React.useContext(ThemeCtx);
  if (!ctx) throw new Error('useAppTheme must be used within AppThemeProvider');
  return ctx;
}

/** Botón minimalista para alternar System → Light → Dark */
export function ThemeToggle() {
  const { mode, setMode } = useAppTheme();
  const next = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
  const label = mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark';
  return (
    <Pressable onPress={() => setMode(next)} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
