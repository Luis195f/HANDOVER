// src/screens/LoginMock.tsx
import React from "react";
import { View, Text, Button } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../lib/auth";

export default function LoginMock() {
  const { loginMock } = useAuth();
  const nav = useNavigation();

  const onLogin = async () => {
    await loginMock();
    // tras login: a la lista de pacientes
    // @ts-ignore
    nav.replace("Patients");
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
