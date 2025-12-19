// src/screens/LoginMock.tsx
import React from "react";
import { View, Text, Button } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { loginWithMockUser } from '@/src/lib/auth';
import type { RootStackParamList } from '@/src/navigation/types';

export default function LoginMock() {
  const nav = useNavigation<NavigationProp<RootStackParamList>>();

  const onLogin = async () => {
    await loginWithMockUser();
    // tras login: a la lista de pacientes
    const navigator: any = nav;
    if (typeof navigator.replace === 'function') {
      navigator.replace("PatientList");
    } else {
      navigator.navigate?.("PatientList");
    }
  };

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
