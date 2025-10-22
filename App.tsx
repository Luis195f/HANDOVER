// FILE: App.tsx
// Entrypoint: banner global + tema dark/light/system + StatusBar,
// y daemon de sincronización (con fallback a installQueueSync).

import React from 'react';
import { StatusBar, View } from 'react-native';
// import 'react-native-gesture-handler';

import RootNavigator from '@/src/navigation/RootNavigator';
import { installQueueSync } from '@/src/lib/queueBootstrap';
import { AppThemeProvider, useAppTheme } from '@/src/theme';
import OfflineBanner from '@/src/components/OfflineBanner';
import { navigate as nav } from '@/src/navigation/navigation';

// Tipos suaves para no romper si cambian firmas internas
type GetToken = () => Promise<string | null>;
type StartSyncDaemonFn = (opts: {
  fhirBaseUrl: string;
  getToken: GetToken;
  backoff?: { retries?: number; minMs?: number; maxMs?: number };
}) => (() => void) | void;

// Shell: aplica StatusBar según tema y muestra el banner global
function AppShell() {
  const { isDark, navTheme } = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: navTheme.colors.background }}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={navTheme.colors.background}
      />
      {/* BANNER GLOBAL: aparece sobre TODAS las pantallas; tap → SyncCenter */}
      <OfflineBanner onPress={() => nav('SyncCenter')} />
      <RootNavigator />
    </View>
  );
}

export default function App() {
  React.useEffect(() => {
    // Preferimos el nuevo daemon de sync; si no está disponible, fallback.
    let stop: (() => void) | undefined; // ← evita TS2349

    // 1) Resolver startSyncDaemon de forma tolerante
    let startSyncDaemon: StartSyncDaemonFn | null = null;
    try {
      // @ts-ignore (puede no existir en builds antiguos)
      const mod = require('@/src/lib/sync');
      startSyncDaemon = (mod?.startSyncDaemon ?? mod?.default?.startSyncDaemon) as StartSyncDaemonFn;
    } catch {
      startSyncDaemon = null;
    }

    // 2) Resolver base FHIR de forma tolerante
    let fhirBase = '';
    try {
      // @ts-ignore
      const env = require('@/src/config/env');
      // intenta varias claves comunes
      fhirBase =
        env?.ENV?.FHIR_BASE ??
        env?.FHIR_BASE ??
        env?.CONFIG?.FHIR_BASE_URL ??
        fhirBase;
    } catch {
      // @ts-ignore (Expo env)
      fhirBase = (process?.env?.EXPO_PUBLIC_FHIR_BASE as string) ?? '';
    }

    // 3) Resolver getToken de forma tolerante
    let getToken: GetToken = async () => null;
    try {
      // @ts-ignore
      const auth = require('@/src/services/AuthService');
      getToken =
        (auth?.getToken as GetToken) ??
        (auth?.default?.getToken as GetToken) ??
        getToken;
    } catch {
      // noop
    }

    // 4) Lanzar daemon o fallback
    if (startSyncDaemon && fhirBase) {
      const ret = startSyncDaemon({
        fhirBaseUrl: fhirBase,
        getToken,
        backoff: { retries: 5, minMs: 500, maxMs: 15000 },
      });
      if (typeof ret === 'function') stop = ret;
      if (__DEV__) console.log('[App] startSyncDaemon enabled', { fhirBase });
    } else {
      try {
        // Integramos tu snippet: opciones por defecto
        const unsub = installQueueSync?.({
          intervalMs: 15000,
          jitterMs: 3000,
          maxTries: 5,
        });
        if (typeof unsub === 'function') stop = unsub;
        if (__DEV__) console.log('[App] fallback installQueueSync enabled');
      } catch (e) {
        if (__DEV__) console.warn('[App] no sync bootstrap available', e);
      }
    }

    return () => {
      try {
        if (typeof stop === 'function') stop(); // ← type guard, evita TS2349
      } catch {}
    };
  }, []);

  return (
    <AppThemeProvider>
      <AppShell />
    </AppThemeProvider>
  );
}
