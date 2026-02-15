// src/screens/LoginScreen.tsx
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Controller, useForm } from "react-hook-form";

import { useAuth } from "@/src/security/auth";
import { useNetInfo } from "@/src/lib/netinfo";
import { hasNetwork } from "@/src/lib/fast-validate";
import { useThemeTokens } from "@/src/theme";
import { t } from "@/src/i18n";
import { isDemoAccessEnabled } from "@/src/security/demo-access";

type LoginFormValues = {
  username: string;
  password: string;
};

export default function LoginScreen() {
  const { loginWithCredentials, loginDemo, loginWithOAuth } = useAuth();
  const { colors, spacing, radius, fontSizes } = useThemeTokens();

  const netInfo = useNetInfo();
  const isOnline = useMemo(() => hasNetwork(netInfo), [netInfo]);

  const [submitting, setSubmitting] = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  const [demoSubmitting, setDemoSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { username: "", password: "" },
  });

  const ensureOnline = useCallback(() => {
    if (isOnline) return true;
    Alert.alert(t("login.offlineAlertTitle"), t("login.offlineAlertMessage"));
    return false;
  }, [isOnline]);

  // Importante: NO navegamos manualmente.
  // RootNavigator cambia el árbol cuando session se setea.
  const handleCredentials = useCallback(
    async (values: LoginFormValues) => {
      if (!ensureOnline()) return;
      setSubmitting(true);
      try {
        await loginWithCredentials(values);
      } catch (error) {
        const message = (error as { message?: string }).message ?? "";
        if (message.includes("INVALID_CREDENTIALS")) {
          Alert.alert(t("login.invalidCredentialsTitle"), t("login.invalidCredentialsMessage"));
          return;
        }
        Alert.alert(t("login.loginErrorTitle"), t("login.loginErrorMessage"));
      } finally {
        setSubmitting(false);
      }
    },
    [ensureOnline, loginWithCredentials],
  );

  const handleOAuth = useCallback(async () => {
    if (!ensureOnline()) return;
    if (!loginWithOAuth) {
      Alert.alert(t("login.loginErrorTitle"), t("login.oauthUnavailableMessage"));
      return;
    }
    setOauthSubmitting(true);
    try {
      await loginWithOAuth();
    } catch (error) {
      const message = (error as { message?: string }).message ?? "";
      Alert.alert(t("login.loginErrorTitle"), message || t("login.loginErrorMessage"));
    } finally {
      setOauthSubmitting(false);
    }
  }, [ensureOnline, loginWithOAuth]);

  const handleDemo = useCallback(async () => {
    setDemoSubmitting(true);
    try {
      await loginDemo();
    } finally {
      setDemoSubmitting(false);
    }
  }, [loginDemo]);

  const isDemoEnabled = isDemoAccessEnabled();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          padding: spacing.lg,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.md,
          backgroundColor: colors.background,
        },
        title: { fontSize: 22, fontWeight: "700", color: colors.text },
        subtitle: { textAlign: "center", color: colors.muted },
        inputGroup: { width: "100%", maxWidth: 320, gap: spacing.xs },
        label: { fontSize: fontSizes.sm, color: colors.text, fontWeight: "600" },
        input: {
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          color: colors.text,
        },
        inputError: { borderColor: colors.danger },
        errorText: { color: colors.danger, fontSize: fontSizes.sm },
        button: {
          width: "100%",
          maxWidth: 320,
          paddingVertical: spacing.sm,
          borderRadius: radius.sm,
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: spacing.sm,
        },
        primaryButton: { backgroundColor: colors.primary },
        primaryText: { color: colors.onPrimary },
        secondaryButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        secondaryText: { color: colors.text },
        buttonText: { fontWeight: "700" },
        helper: { marginTop: spacing.sm, textAlign: "center", color: colors.muted },
        offlineText: { color: colors.warning, textAlign: "center" },
      }),
    [colors, fontSizes.sm, radius.sm, spacing.lg, spacing.md, spacing.sm, spacing.xs],
  );

  const isBusy = submitting || oauthSubmitting || demoSubmitting;

  return (
    <View style={styles.container}>
      <Text allowFontScaling style={styles.title}>{t("login.title")}</Text>
      <Text allowFontScaling style={styles.subtitle}>{t("login.subtitle")}</Text>

      <View style={styles.inputGroup}>
        <Text allowFontScaling style={styles.label}>{t("login.usernameLabel")}</Text>
        <Controller
          control={control}
          name="username"
          rules={{ required: t("login.usernameRequired") }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel={t("login.usernameLabel")}
              accessibilityHint={t("login.usernameHint")}
              testID="login-username"
              placeholder={t("login.usernamePlaceholder")}
              placeholderTextColor={colors.muted}
              allowFontScaling
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              style={[styles.input, errors.username ? styles.inputError : null]}
            />
          )}
        />
        {errors.username ? <Text allowFontScaling style={styles.errorText}>{errors.username.message}</Text> : null}
      </View>

      <View style={styles.inputGroup}>
        <Text allowFontScaling style={styles.label}>{t("login.passwordLabel")}</Text>
        <Controller
          control={control}
          name="password"
          rules={{ required: t("login.passwordRequired") }}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              accessibilityLabel={t("login.passwordLabel")}
              accessibilityHint={t("login.passwordHint")}
              testID="login-password"
              placeholder={t("login.passwordPlaceholder")}
              placeholderTextColor={colors.muted}
              allowFontScaling
              secureTextEntry
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              style={[styles.input, errors.password ? styles.inputError : null]}
            />
          )}
        />
        {errors.password ? <Text allowFontScaling style={styles.errorText}>{errors.password.message}</Text> : null}
      </View>

      <Pressable
        onPress={handleSubmit(handleCredentials)}
        style={[styles.button, styles.primaryButton, (!isOnline || isBusy) ? { opacity: 0.6 } : null]}
        accessibilityRole="button"
        accessibilityLabel={t("login.signInAccessibility")}
        accessibilityHint={t("login.signInHint")}
        testID="login-submit"
        disabled={!isOnline || isBusy}
      >
        {submitting ? <ActivityIndicator color={colors.onPrimary} /> : null}
        <Text allowFontScaling style={[styles.buttonText, styles.primaryText]}>
          {submitting ? t("login.loading") : t("login.signIn")}
        </Text>
      </Pressable>

      <Pressable
        onPress={handleOAuth}
        style={[styles.button, styles.secondaryButton, (!isOnline || isBusy) ? { opacity: 0.6 } : null]}
        accessibilityRole="button"
        accessibilityLabel={t("login.oauthAccessibility")}
        accessibilityHint={t("login.oauthHint")}
        testID="login-auth0"
        disabled={!isOnline || isBusy || !loginWithOAuth}
      >
        {oauthSubmitting ? <ActivityIndicator color={colors.text} /> : null}
        <Text allowFontScaling style={[styles.buttonText, styles.secondaryText]}>
          {oauthSubmitting ? t("login.oauthConnecting") : t("login.oauthButton")}
        </Text>
      </Pressable>

      {!isOnline ? <Text allowFontScaling style={styles.offlineText}>{t("login.offlineIndicator")}</Text> : null}

      {isDemoEnabled ? (
        <>
          <Pressable
            onPress={handleDemo}
            style={[styles.button, styles.secondaryButton, isBusy ? { opacity: 0.6 } : null]}
            accessibilityRole="button"
            accessibilityLabel={t("login.demoAccessibility")}
            accessibilityHint={t("login.demoHint")}
            testID="login-demo"
            disabled={isBusy}
          >
            {demoSubmitting ? <ActivityIndicator color={colors.text} /> : null}
            <Text allowFontScaling style={[styles.buttonText, styles.secondaryText]}>{t("login.demoButton")}</Text>
          </Pressable>

          <Text allowFontScaling style={styles.helper}>{t("login.demoHelper")}</Text>
        </>
      ) : null}
    </View>
  );
}
