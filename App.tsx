import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { ErrorUtils, setJSExceptionHandler } from "react-native-exception-handler";

import RootNavigator from "@/src/navigation/RootNavigator";
import { navigationRef } from "@/src/navigation/navigation";
import { installQueueSync } from "@/src/lib/queueBootstrap";
import { installErrorLogSync, reportError } from "@/src/lib/error-logging";
import { SettingsProvider } from "@/src/context/settings-context";
import { AppThemeProvider } from "@/src/theme";
import { AuthProvider } from "@/src/security/auth";

export default function App() {
  React.useEffect(() => {
    const handler = (error: Error, isFatal?: boolean) => {
      void reportError(error, { isFatal });
    };

    setJSExceptionHandler(handler, false);
    // @ts-expect-error ErrorUtils no expone tipos en RN web/test
    ErrorUtils?.setGlobalHandler?.(handler);
  }, []);

  React.useEffect(() => {
    let stop: (() => void) | undefined;
    try {
      const ret = installQueueSync?.({ intervalMs: 15000, jitterMs: 3000, maxTries: 5 });
      if (typeof ret === "function") stop = ret;
    } catch (e) {
      if (__DEV__) console.warn("[App] queue sync not available", e);
    }
    return () => {
      try {
        if (typeof stop === "function") stop();
      } catch {}
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = installErrorLogSync();
    return () => {
      try {
        unsubscribe?.();
      } catch {}
    };
  }, []);

  return (
    <SettingsProvider>
      <AuthProvider>
        <AppThemeProvider>
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        </AppThemeProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}
