import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { setShareErrorLogsPreference, syncErrorLogs } from '@/src/lib/error-logging';

type SettingsState = {
  shareErrorLogs: boolean;
  loading: boolean;
  setShareErrorLogs: (value: boolean) => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);
const KEY = 'handover.settings.shareErrorLogs';

async function readSharePreference(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return false;
    return raw === 'true' || raw === '1' || raw === '"true"';
  } catch {
    return false;
  }
}

async function persistSharePreference(value: boolean): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(KEY, 'true');
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [shareErrorLogs, setShareErrorLogsState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const pref = await readSharePreference();
      setShareErrorLogsState(pref);
      setShareErrorLogsPreference(pref);
      if (pref) {
        await syncErrorLogs();
      }
      setLoading(false);
    })();
  }, []);

  const updateShareErrorLogs = async (value: boolean) => {
    setShareErrorLogsState(value);
    setShareErrorLogsPreference(value);
    await persistSharePreference(value);
    if (value) {
      await syncErrorLogs();
    }
  };

  const value = useMemo<SettingsState>(
    () => ({ shareErrorLogs, loading, setShareErrorLogs: updateShareErrorLogs }),
    [loading, shareErrorLogs]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
