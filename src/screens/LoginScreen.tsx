// src/screens/LoginScreen.tsx
import React, { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { UNITS_BY_ID } from "@/src/config/units";
import { login, getSession, logout } from "@/src/security/auth";
import type { Session } from "@/src/security/auth";

export default function LoginScreen({ navigation }: any) {
  // Todos los slugs de unidades disponibles en la app
  const ALL_UNITS = Object.keys(UNITS_BY_ID);

  const grantFullAccess = async () => {
    // Sesión demo con acceso total – RBAC “abierto”
    await login({
      user: {
        id: "nurse-1",
        name: "Demo Nurse",
        // redundante pero explícito: el usuario también las lleva
        units: ALL_UNITS,
        allowedUnits: ALL_UNITS,
      },
      // y a nivel raíz de sesión también
      units: ALL_UNITS,
      allowedUnits: ALL_UNITS,
      token: "mock-token",
    });

    // Ir directo al listado
    navigation.reset({ index: 0, routes: [{ name: "PatientList" }] });
  };

  // Si hay sesión previa y no tiene todas las unidades, la “sube” automáticamente (DEV)
  useEffect(() => {
    (async () => {
      try {
        const s = (await getSession()) as Partial<Session> | null;
        // 👇 Log que me pediste
        console.log("[dev] session", s?.units, s?.user?.allowedUnits);

        const allowed = new Set<string>([
          ...(s?.units ?? []),
          ...(s?.allowedUnits ?? []),
          ...(s?.user?.units ?? []),
          ...(s?.user?.allowedUnits ?? []),
        ]);

        const missing = ALL_UNITS.some((u) => !allowed.has(u));
        if (__DEV__ && (missing || !s)) {
          await grantFullAccess();
        }
      } catch {
        // En cualquier duda, abrimos todo en DEV
        if (__DEV__) await grantFullAccess();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, padding: 16, gap: 12, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700", marginBottom: 6 }}>
        Handover · Demo
      </Text>
      <Text style={{ opacity: 0.7, marginBottom: 12 }}>
        Acceso total a todas las unidades para pruebas.
      </Text>

      <Pressable
        onPress={grantFullAccess}
        style={{
          backgroundColor: "#1e88e5",
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>
          Entrar (todas las unidades)
        </Text>
      </Pressable>

      {__DEV__ && (
        <Pressable
          onPress={async () => {
            try {
              await logout?.();
            } catch {}
            await grantFullAccess();
          }}
          style={{
            marginTop: 8,
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#d0d0d0",
            alignItems: "center",
          }}
        >
          <Text>Resetear permisos (DEV)</Text>
        </Pressable>
      )}
    </View>
  );
}
