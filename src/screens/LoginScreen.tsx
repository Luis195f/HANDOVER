// src/screens/LoginScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Controller, useForm } from 'react-hook-form';
import { useAuth } from '@/src/security/auth';
import { useNetInfo } from '@/src/lib/netinfo';
import { hasNetwork } from '@/src/lib/fast-validate';
import { useThemeTokens } from '@/src/theme';

type LoginFormValues = {
  username: string;
  password: string;
};

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const { loginWithCredentials, loginDemo } = useAuth();
  const { colors, spacing, radius, fontSizes } = useThemeTokens();
  const netInfo = useNetInfo();
  const isOnline = useMemo(() => hasNetwork(netInfo), [netInfo]);
  const [submitting, setSubmitting] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { username: '', password: '' },
  });

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

  const handleCredentials = useCallback(
    async (values: LoginFormValues) => {
      if (!isOnline) {
        Alert.alert('Sin conexión a Internet', 'Conéctate para iniciar sesión.');
        return;
      }
      setSubmitting(true);
      try {
        await loginWithCredentials(values);
        goToHome();
      } catch (error) {
        const message = (error as { message?: string }).message ?? '';
        if (message.includes('INVALID_CREDENTIALS')) {
          Alert.alert('Credenciales inválidas', 'Usuario o contraseña incorrectos.');
          return;
        }
        Alert.alert('Error de inicio de sesión', 'No se pudo iniciar sesión. Intenta de nuevo.');
      } finally {
        setSubmitting(false);
      }
    },
    [goToHome, isOnline, loginWithCredentials],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          padding: spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.md,
          backgroundColor: colors.background,
        },
        title: { fontSize: 22, fontWeight: '700', color: colors.text },
        subtitle: { textAlign: 'center', color: colors.muted },
        inputGroup: { width: '100%', maxWidth: 320, gap: spacing.xs },
        label: { fontSize: fontSizes.sm, color: colors.text, fontWeight: '600' },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          color: colors.text,
        },
        inputError: {
          borderColor: colors.danger,
        },
        errorText: { color: colors.danger, fontSize: fontSizes.sm },
        button: {
          width: '100%',
          maxWidth: 320,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: spacing.sm,
        },
        primaryButton: { backgroundColor: colors.primary },
        primaryText: { color: colors.onPrimary },
        demoButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        demoText: { color: colors.text },
        buttonText: { fontWeight: '700' },
        helper: { marginTop: spacing.sm, textAlign: 'center', color: colors.muted },
        offlineText: { color: colors.warning, textAlign: 'center' },
      }),
    [colors, fontSizes.sm, radius.sm, spacing.lg, spacing.md, spacing.sm, spacing.xs],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Handover Pro</Text>
      <Text style={styles.subtitle}>Inicia sesión con tu cuenta.</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Usuario</Text>
        <Controller
          control={control}
          name="username"
          rules={{ required: 'El usuario es obligatorio' }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel="Usuario"
              placeholder="Usuario"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              style={[styles.input, errors.username ? styles.inputError : null]}
            />
          )}
        />
        {errors.username ? <Text style={styles.errorText}>{errors.username.message}</Text> : null}
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Contraseña</Text>
        <Controller
          control={control}
          name="password"
          rules={{ required: 'La contraseña es obligatoria' }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel="Contraseña"
              placeholder="Contraseña"
              placeholderTextColor={colors.muted}
              secureTextEntry
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              style={[styles.input, errors.password ? styles.inputError : null]}
            />
          )}
        />
        {errors.password ? <Text style={styles.errorText}>{errors.password.message}</Text> : null}
      </View>

      <Pressable
        onPress={handleSubmit(handleCredentials)}
        style={[
          styles.button,
          styles.primaryButton,
          (!isOnline || submitting) ? { opacity: 0.6 } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con credenciales"
        disabled={!isOnline || submitting}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : null}
        <Text style={[styles.buttonText, styles.primaryText]}>
          {submitting ? 'Cargando…' : 'Iniciar sesión'}
        </Text>
      </Pressable>

      {!isOnline ? <Text style={styles.offlineText}>Sin conexión a Internet</Text> : null}

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
