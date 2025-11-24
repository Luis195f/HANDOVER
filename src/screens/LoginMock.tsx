// src/screens/LoginMock.tsx
import React, { useCallback } from "react";
import { View, Text, Button, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { loginWithMockUser } from '@/src/security/auth';

const MOCK_AUTH_ENABLED = (process.env.EXPO_PUBLIC_USE_MOCK_AUTH ?? process.env.USE_MOCK_AUTH ?? '').toLowerCase() === 'true';

export default function LoginMock() {
  const nav = useNavigation();

  const onLogin = useCallback(async () => {
    if (!MOCK_AUTH_ENABLED) {
      Alert.alert('Demo deshabilitada', 'Activa USE_MOCK_AUTH=true para usar este flujo.');
      return;
    }
    await loginWithMockUser();
    // @ts-ignore
    nav.replace("Patients");
  }, [nav]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: "600", marginBottom: 12 }}>Ingreso (Mock)</Text>
      <Text style={{ textAlign: "center", marginBottom: 24 }}>
        Este login simula OIDC/SMART en FASE 0. Se reemplazará por OAuth real.
      </Text>
      <Button title="Entrar como enfermera" onPress={onLogin} />
    </View>
  );
}
