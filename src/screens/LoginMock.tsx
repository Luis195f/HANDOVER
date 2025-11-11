import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type RootStackParamList = {
  PatientList: undefined;
  HandoverMain: undefined;
};

export default function LoginMock() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const goIn = () => {
    // Intento principal
    try {
      navigation.reset({ index: 0, routes: [{ name: "PatientList" as any }] });
      return;
    } catch {}
    // Fallback si el nombre de ruta fuera distinto
    try {
      navigation.reset({ index: 0, routes: [{ name: "HandoverMain" as any }] });
      return;
    } catch {}
    // Último recurso: navega "a lo que haya"
    // (evita quedar bloqueado si el stack cambia)
    // @ts-ignore
    navigation.goBack?.();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ingreso (Mock)</Text>
      <Text style={styles.subtitle}>
        Este login simula OIDC/SMART en FASE 0. Se reemplazará por OAuth real.
      </Text>

      <Pressable onPress={goIn} style={({pressed}) => [styles.btn, pressed && {opacity:0.8}]}>
        <Text style={styles.btnText}>ENTRAR COMO ENFERMERA</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor:"#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: "center", opacity: 0.8, marginBottom: 24 },
  btn: { backgroundColor: "#2196F3", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 6, elevation: 4 },
  btnText: { color: "#fff", fontWeight: "600", letterSpacing: 0.5 }
});
