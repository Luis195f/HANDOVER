import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootNavigator from '@/src/navigation/RootNavigator';
import { AppThemeProvider } from '@/src/theme';
import { navigationRef } from '@/src/navigation/navigation';
import { AuthProvider } from '@/src/lib/auth/AuthContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <AuthProvider>
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
