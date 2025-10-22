// FILE: src/screens/LoginScreen.tsx (stub)
import React from 'react';
import { View, Text, Button } from 'react-native';
import { login } from '@/src/security/auth';

export default function LoginScreen() {
  const onLogin = async () => {
    await login({ user: { id: 'nurse-1', name: 'Demo Nurse' }, units: ['MED-1', 'UCI-3'], token: 'mock-token' });
  };
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Text>Acceder</Text>
      <Button title="Entrar (mock)" onPress={onLogin} />
    </View>
  );
}
