import React, { useEffect, useState } from "react";
import { Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemeToggle } from "@/src/theme";
import { apiGet } from "@/src/lib/api"; // si no existe, te dejo abajo un stub

export default function Root() {
  const [ping, setPing] = useState<"…" | "ok" | "fail">("…");

  const refresh = async () => {
    try {
      await apiGet("/api/ping");
      setPing("ok");
    } catch {
      setPing("fail");
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 12 }}>HANDOVER</Text>
      <ThemeToggle />
      <Text style={{ marginTop: 16 }}>Backend ping: {ping}</Text>
      <Pressable onPress={refresh} style={{ marginTop: 10 }}>
        <Text>Reintentar</Text>
      </Pressable>
    </SafeAreaView>
  );
}
