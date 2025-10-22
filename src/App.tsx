import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import RootNavigator from "@/src/navigation/RootNavigator";
import { navigationRef } from "@/src/navigation/navigation";
import { installQueueSync } from "@/src/lib/queueBootstrap";

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
    } catch (e) {
      if (__DEV__) console.warn("[App] queue sync not available", e);
    }
    return () => { try { if (typeof stop === "function") stop(); } catch {} };
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>
  );
}
