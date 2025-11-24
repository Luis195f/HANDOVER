// src/screens/LoginScreen.tsx
import React, { useCallback } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '@/src/security/auth';

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const { loginWithOIDC, loginWithMockUser, isMockAuthEnabled } = useAuth();

  const handleLogin = useCallback(async () => {
    try {
      await loginWithOIDC();
      navigation.reset({ index: 0, routes: [{ name: 'PatientList' }] });
    } catch (error) {
      console.error('OIDC login failed', error);
      Alert.alert('No se pudo iniciar sesión', 'Revisa tu conexión o la configuración OIDC.');
    }
  }, [loginWithOIDC, navigation]);

  const handleMockLogin = useCallback(async () => {
    if (!loginWithMockUser) return;
    try {
      await loginWithMockUser();
      navigation.reset({ index: 0, routes: [{ name: 'PatientList' }] });
    } catch (error) {
      Alert.alert('Login demo deshabilitado', `${error}`);
    }
  }, [loginWithMockUser, navigation]);

  return (
    <View style={{ flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Handover Pro</Text>
      <Pressable
        onPress={handleLogin}
        style={{ backgroundColor: '#1677ff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
      >
        <Text style={{ color: 'white', fontWeight: '600' }}>Iniciar sesión</Text>
      </Pressable>
      {isMockAuthEnabled && loginWithMockUser ? (
        <Pressable
          onPress={handleMockLogin}
          style={{ marginTop: 12, backgroundColor: '#475569', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>Iniciar sesión (demo)</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
