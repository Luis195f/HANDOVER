import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";

import RootNavigator from "./src/navigation/RootNavigator";
import { AppThemeProvider } from "./src/theme";
import { navigationRef } from "./src/navigation/navigation";
import { AuthProvider } from "./src/lib/auth/AuthContext";

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppThemeProvider>
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        </AppThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

