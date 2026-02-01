import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/src/navigation/types";

import { hasPrivacyConsent } from "@/src/lib/privacy-consent";

// Intentar importar un setter si existe (sin romper si no existe).
// Si tu proyecto NO tiene este export, deja este bloque tal cual y usa el fallback.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const privacyLib: any = (() => {
  try {
    // require para evitar fallo si el export no existe
    return require("@/src/lib/privacy-consent");
  } catch {
    return {};
  }
})();

type Props = NativeStackScreenProps<RootStackParamList, "PrivacyConsent">;

export default function PrivacyConsentScreen({ navigation }: Props) {
  const [saving, setSaving] = React.useState(false);

  async function persistConsentTrue() {
    // 1) Si existe setPrivacyConsent(true), úsalo
    if (typeof privacyLib.setPrivacyConsent === "function") {
      await privacyLib.setPrivacyConsent(true);
      return;
    }

    // 2) Si existe setHasPrivacyConsent(true), úsalo
    if (typeof privacyLib.setHasPrivacyConsent === "function") {
      await privacyLib.setHasPrivacyConsent(true);
      return;
    }

    // 3) Fallback: si tu hasPrivacyConsent ya mira storage interno, esto puede no servir.
    // Pero evitamos romper el build: si no hay setter, al menos lo informamos.
    throw new Error(
      "No se encontró una función para guardar el consentimiento (setPrivacyConsent / setHasPrivacyConsent)."
    );
  }

  const onAccept = async () => {
    setSaving(true);
    try {
      await persistConsentTrue();

      // Verificación rápida (opcional) para evitar loop
      const ok = await hasPrivacyConsent().catch(() => true);
      if (!ok) {
        // Si tu hasPrivacyConsent usa otra fuente y no refleja el cambio, no bloqueamos.
        // Solo prevenimos un loop evidente.
        console.warn("[PrivacyConsent] Consent not reflected by hasPrivacyConsent()");
      }

      // En tu AuthGate, postOnboardingRoute depende de roles.
      // Aquí navegamos a PatientList (si tiene permisos, entra; si no, caerá en Unauthorized).
      navigation.reset({
        index: 0,
        routes: [{ name: "PatientList" }],
      });
    } catch (e: any) {
      Alert.alert(
        "No se pudo guardar el consentimiento",
        e?.message ?? "Error desconocido"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Consentimiento de privacidad</Text>

      <Text style={styles.body}>
        Para continuar, necesitamos tu consentimiento para el tratamiento de datos según la política
        de privacidad. En modo demo, usa solo datos ficticios.
      </Text>

      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => navigation.navigate("PrivacyPolicy")}
        disabled={saving}
      >
        <Text style={styles.secondaryText}>Ver política de privacidad</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.primary, saving && styles.disabled]}
        onPress={onAccept}
        disabled={saving}
      >
        <Text style={styles.primaryText}>{saving ? "Guardando..." : "Acepto y continuar"}</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.ghost]}
        onPress={() => navigation.navigate("PrivacyPolicy")}
        disabled={saving}
      >
        <Text style={styles.ghostText}>Ahora no</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  primary: { backgroundColor: "#0f172a" },
  primaryText: { color: "white", fontWeight: "600" },
  secondary: { backgroundColor: "white", borderWidth: 1, borderColor: "#cbd5e1" },
  secondaryText: { color: "#0f172a", fontWeight: "600" },
  ghost: { backgroundColor: "transparent" },
  ghostText: { color: "#334155" },
  disabled: { opacity: 0.7 },
});
