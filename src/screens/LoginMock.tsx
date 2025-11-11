import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";

type RootStackParamList = {
  PatientList: undefined;
  HandoverMain: undefined;
};

type ResetRoute = { name: keyof RootStackParamList } & Record<string, unknown>;

type ResetParams = { index: number; routes: ResetRoute[] };

export default function LoginMock() {
  const navigation = useNavigation<any>();

  const goIn = () => {
    const go = (params: ResetParams) => {
      try {
        navigation.reset(params);
        return true;
      } catch {
        return false;
      }
    };

    if (go({ index: 0, routes: [{ name: "PatientList" }] })) return;
    if (go({ index: 0, routes: [{ name: "HandoverMain" }] })) return;
    navigation.goBack?.();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ingreso (Mock)</Text>
      <Text style={styles.subtitle}>
        Este login simula OIDC/SMART en FASE 0. Se reemplazará por OAuth real.
      </Text>

      <Pressable onPress={goIn} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}>
        <Text style={styles.btnText}>ENTRAR COMO ENFERMERA</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: "center", opacity: 0.8, marginBottom: 24 },
  btn: { backgroundColor: "#2196F3", paddingVertical: 14, paddingHorizontal: 22, borderRadius: 6, elevation: 4 },
  btnText: { color: "#fff", fontWeight: "600", letterSpacing: 0.5 },
});
