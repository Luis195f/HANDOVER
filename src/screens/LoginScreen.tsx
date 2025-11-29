// src/screens/LoginScreen.tsx
import React, { useCallback } from 'react';
import { Alert, View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@/src/security/auth';

const isAuthCancelledError = (error: unknown): boolean => {
  if (!error) return false;
  const message = (error as { message?: string }).message ?? String(error);
  return message.includes('OAUTH_CANCELLED') || (error as { type?: string }).type === 'dismiss';
};

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const { loginWithOAuth, loginDemo } = useAuth();

  const goToHome = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'PatientList' }],
    });
  }, [navigation]);

  const handleDemo = useCallback(async () => {
    await loginDemo();
    goToHome();
  }, [goToHome, loginDemo]);

  const handleOAuth = useCallback(async () => {
    try {
      await loginWithOAuth();
      goToHome();
    } catch (error) {
      if (isAuthCancelledError(error)) {
        return;
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[login] Failed to authenticate', error);
      Alert.alert('No se pudo iniciar sesión', 'Vuelve a intentarlo en unos segundos.');
    }
  }, [goToHome, loginWithOAuth]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Handover Pro</Text>
      <Text style={styles.subtitle}>Inicia sesión con tu cuenta o prueba el modo demo.</Text>

      <Pressable
        onPress={handleOAuth}
        style={[styles.button, styles.primaryButton]}
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con credenciales"
      >
        <Text style={[styles.buttonText, styles.primaryText]}>Iniciar sesión</Text>
      </Pressable>

      <Pressable
        onPress={handleDemo}
        style={[styles.button, styles.demoButton]}
        accessibilityRole="button"
        accessibilityLabel="Iniciar demo con datos ficticios"
      >
        <Text style={[styles.buttonText, styles.demoText]}>Iniciar demo</Text>
      </Pressable>

      <Text style={styles.helper}>Modo demo – datos ficticios, no usar con pacientes reales.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { textAlign: 'center', color: '#52606d' },
  button: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: { backgroundColor: '#1677ff' },
  primaryText: { color: '#fff' },
  demoButton: { backgroundColor: '#e0f2fe', borderWidth: 1, borderColor: '#b6e0fe' },
  demoText: { color: '#0b69a3' },
  buttonText: { fontWeight: '700' },
  helper: { marginTop: 8, textAlign: 'center', color: '#52606d' },
});
