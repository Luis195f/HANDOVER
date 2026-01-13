// src/theme/index.tsx
import React, {createContext, useContext, useMemo, useState} from 'react';
import {Text, useColorScheme} from 'react-native';

type Theme = 'light' | 'dark';
type Ctx = { theme: Theme; toggle: () => void };

const Ctx = createContext<Ctx | null>(null);

export const Colors = {
  primary: '#1E1B4B',
  danger: '#DC2626',
  background: '#FFFFFF',
  border: '#D1D5DB',
  text: '#1F2937',
  muted: '#6B7280',
  surface: '#F9FAFB',
  warning: '#F59E0B',
  success: '#16A34A',
  info: '#2563EB',
} as const;

type ColorsTokens = { [K in keyof typeof Colors]: string };

export const FontSizes = { sm: 14, base: 16, lg: 18, xl: 20 } as const;
export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12 } as const;

export type ThemeTokens = {
  colors: ColorsTokens;
  fontSizes: typeof FontSizes;
  spacing: typeof Spacing;
  radius: typeof Radius;
  isDark: boolean;
};

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

export function useThemeTokens(): ThemeTokens {
  const ctx = useContext(Ctx);
  const system = (useColorScheme() ?? 'light') as Theme;

  if (!ctx) {
    console.warn('[handover-ui] UI_THEME_PROVIDER_MISSING', { module: 'src/theme/index.tsx' });
  }

  const theme = ctx?.theme ?? system;
  const isDark = theme === 'dark';

  const colors = useMemo<ColorsTokens>(() => {
    if (!isDark) return Colors;
    return {
      ...Colors,
      background: '#111827',
      surface: '#0F172A',
      text: '#E5E7EB',
      muted: '#9CA3AF',
      border: '#374151',
    };
  }, [isDark]);

  return useMemo(
    () => ({
      colors,
      fontSizes: FontSizes,
      spacing: Spacing,
      radius: Radius,
      isDark,
    }),
    [colors, isDark]
  );
}

// Opcional: botón simple para probar
export function ThemeToggle() {
  const { theme, toggle } = useAppTheme();
  return <Text onPress={toggle}>Theme: {theme} (tap)</Text>;
}
