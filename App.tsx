import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { navigationRef } from "@/src/navigation/navigation";
import { AppThemeProvider } from "@/src/theme";
import { AuthProvider } from "@/src/security/auth";

export default function App() {
  return (
    <AuthProvider>
      <AppThemeProvider>
        <NavigationContainer ref={navigationRef}>
          {/* El resto de tu Stack está en RootNavigator */}
        </NavigationContainer>
      </AppThemeProvider>
    </AuthProvider>
  );
}
