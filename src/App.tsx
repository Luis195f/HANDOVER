import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootNavigator from "@/src/navigation/RootNavigator";
import { navigationRef } from "@/src/navigation/navigation";
import { installQueueSync } from "@/src/lib/queueBootstrap";
import { AuthProvider } from "@/src/security/auth";
import { warn } from "@/src/lib/otel";
import NetInfo from "@react-native-community/netinfo";
import { setOnline, onReconnect } from "@/src/lib/queue";
import { flushQueue } from "@/src/lib/sync";

export default function App() {
  // Bootstrap de cola (opcional; no rompe si no existe)
  React.useEffect(() => {
    let stop: (() => void) | undefined;
    try {
      const ret = installQueueSync?.({
        intervalMs: 15000,
        jitterMs: 3000,
        maxTries: 5,
      });
      if (typeof ret === "function") stop = ret;
    } catch {
      warn(
        "APP_QUEUE_SYNC_UNAVAILABLE",
        "[APP_QUEUE_SYNC_UNAVAILABLE] Queue sync not available; continuing without background sync.",
        { source: "installQueueSync" }
      );
    }
    return () => { try { if (typeof stop === "function") stop(); } catch {} };
  }, []);

  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected);
    });
    const off = onReconnect(() => {
      void flushQueue();
    });
    return () => {
      unsubscribe();
      off();
    };
  }, []);

  return (
    <AuthProvider>
      <NavigationContainer ref={navigationRef}>
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
