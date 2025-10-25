import React, { useEffect, useState } from "react";
import { Text, Pressable, View } from "react-native";
import { ThemeToggle } from "@/src/theme";
import { apiGet } from "@/src/lib/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

type RootStackParamList = { Home: undefined; Handover: undefined };
type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export default function HomeScreen({ navigation }: Props) {
  const [ping, setPing] = useState<"…" | "ok" | "fail">("…");
  const refresh = async () => {
    try { await apiGet("/api/ping"); setPing("ok"); } catch { setPing("fail"); }
  };
  useEffect(() => { refresh(); }, []);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 28, marginBottom: 10 }}>HANDOVER</Text>
      <ThemeToggle />
      <Text style={{ marginTop: 16 }}>Backend ping: {ping}</Text>
      <Pressable onPress={refresh} style={{ marginTop: 8 }}><Text>Reintentar</Text></Pressable>
      <Pressable onPress={() => navigation.navigate("Handover")} style={{ marginTop: 24 }}>
        <Text style={{ fontSize: 18 }}>➜ Entrar</Text>
      </Pressable>
    </View>
  );
}
