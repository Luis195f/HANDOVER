import React from "react";
import { NavigationContainer } from "@react-navigation/native";

import RootNavigator from "@/src/navigation/RootNavigator";
import { navigationRef } from "@/src/navigation/navigation";
import { AppThemeProvider } from "@/src/theme";
import { AuthProvider } from "@/src/security/auth";
import { installQueueSync } from "@/src/lib/queueBootstrap";
import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

export default function App() {
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

  return (
    <AuthProvider>
      <AppThemeProvider>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </AppThemeProvider>
    </AuthProvider>
  );
}
