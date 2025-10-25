// src/theme/index.tsx
import React, {createContext, useContext, useMemo, useState} from 'react';
import {Text, useColorScheme} from 'react-native';

type Theme = 'light' | 'dark';
type Ctx = { theme: Theme; toggle: () => void };

const Ctx = createContext<Ctx | null>(null);

export function AppThemeProvider({children}: {children: React.ReactNode}) {
  const system = (useColorScheme() ?? 'light') as Theme;
  const [theme, setTheme] = useState<Theme>(system);
  const value = useMemo(
    () => ({ theme, toggle: () => setTheme(t => (t === 'light' ? 'dark' : 'light')) }),
    [theme]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppTheme must be used within AppThemeProvider');
  return ctx;
}

// Opcional: botón simple para probar
export function ThemeToggle() {
  const { theme, toggle } = useAppTheme();
  return <Text onPress={toggle}>Theme: {theme} (tap)</Text>;
}
