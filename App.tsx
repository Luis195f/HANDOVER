import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import RootNavigator from '@/src/navigation/RootNavigator';
import { navigationRef } from '@/src/navigation/navigation';

try {
  require('./src/lib/sync');
} catch {}

export default function App() {
  return (
    <NavigationContainer ref={navigationRef}>
      <RootNavigator />
    </NavigationContainer>
  );
}
