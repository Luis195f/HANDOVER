import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/src/navigation/types";

import { emitConsentAuditEvent, hasPrivacyConsent, setPrivacyConsent } from "@/src/lib/privacy-consent";

type Props = NativeStackScreenProps<RootStackParamList, "PrivacyConsent">;

export default function PrivacyConsentScreen({ navigation }: Props) {
  const [saving, setSaving] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);

  const onAccept = async () => {
    if (!accepted) {
      Alert.alert("Consentimiento requerido", "Marca la casilla para continuar.");
      return;
    }
    setSaving(true);
    try {
      const record = await setPrivacyConsent(true, { source: "privacy-consent-screen" });
      void emitConsentAuditEvent("granted", record);

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
        style={styles.checkboxRow}
        onPress={() => setAccepted((prev) => !prev)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
          {accepted ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>
          Confirmo que he leído la política de privacidad y otorgo mi consentimiento.
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.secondary]}
        onPress={() => navigation.navigate("PrivacyPolicy")}
        disabled={saving}
      >
        <Text style={styles.secondaryText}>Ver política de privacidad</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.primary, (saving || !accepted) && styles.disabled]}
        onPress={onAccept}
        disabled={saving || !accepted}
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
  checkboxRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 4,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  checkboxChecked: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  checkboxTick: { color: "white", fontWeight: "700" },
  checkboxLabel: { flex: 1, fontSize: 14, lineHeight: 20, color: "#1e293b" },
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
