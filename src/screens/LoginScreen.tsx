// src/screens/LoginScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Controller, useForm } from 'react-hook-form';
import { useAuth } from '@/src/security/auth';
import { useNetInfo } from '@/src/lib/netinfo';
import { hasNetwork } from '@/src/lib/fast-validate';
import { useThemeTokens } from '@/src/theme';
import { t } from '@/src/i18n';

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
        Alert.alert(t('login.offlineAlertTitle'), t('login.offlineAlertMessage'));
        return;
      }
      setSubmitting(true);
      try {
        await loginWithCredentials(values);
        goToHome();
      } catch (error) {
        const message = (error as { message?: string }).message ?? '';
        if (message.includes('INVALID_CREDENTIALS')) {
          Alert.alert(t('login.invalidCredentialsTitle'), t('login.invalidCredentialsMessage'));
          return;
        }
        Alert.alert(t('login.loginErrorTitle'), t('login.loginErrorMessage'));
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
      <Text style={styles.title}>{t('login.title')}</Text>
      <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>{t('login.usernameLabel')}</Text>
        <Controller
          control={control}
          name="username"
          rules={{ required: t('login.usernameRequired') }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel={t('login.usernameLabel')}
              placeholder={t('login.usernamePlaceholder')}
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
        <Text style={styles.label}>{t('login.passwordLabel')}</Text>
        <Controller
          control={control}
          name="password"
          rules={{ required: t('login.passwordRequired') }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel={t('login.passwordLabel')}
              placeholder={t('login.passwordPlaceholder')}
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
        accessibilityLabel={t('login.signInAccessibility')}
        disabled={!isOnline || submitting}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : null}
        <Text style={[styles.buttonText, styles.primaryText]}>
          {submitting ? t('login.loading') : t('login.signIn')}
        </Text>
      </Pressable>

      {!isOnline ? <Text style={styles.offlineText}>{t('login.offlineIndicator')}</Text> : null}

      <Pressable
        onPress={handleDemo}
        style={[styles.button, styles.demoButton]}
        accessibilityRole="button"
        accessibilityLabel={t('login.demoAccessibility')}
      >
        <Text style={[styles.buttonText, styles.demoText]}>{t('login.demoButton')}</Text>
      </Pressable>

      <Text style={styles.helper}>{t('login.demoHelper')}</Text>
    </View>
  );
}
