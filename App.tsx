import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";

import RootNavigator from "@/src/navigation/RootNavigator";
import { AppThemeProvider } from "@/src/theme";
import { navigationRef } from "@/src/navigation/navigation";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
