// src/screens/LoginMock.tsx
import React from "react";
import { View, Text } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { loginWithMockUser } from '@/src/lib/auth';
import type { RootStackParamList } from '@/src/navigation/types';
import { t } from '@/src/i18n';
import { PrimaryButton } from '@/src/components/PrimaryButton';

export default function LoginMock() {
  const nav = useNavigation<NavigationProp<RootStackParamList>>();

  const onLogin = async () => {
    await loginWithMockUser();
    // tras login: a la lista de pacientes
    const navigator: any = nav;
    if (typeof navigator.replace === 'function') {
      navigator.replace("PatientList");
    } else {
      navigator.navigate?.("PatientList");
    }
  };

  return (
    <View
      accessibilityRole="summary"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <Text allowFontScaling style={{ fontSize: 20, fontWeight: "600", marginBottom: 12 }}>
        {t("loginMock.title")}
      </Text>
      <Text allowFontScaling style={{ textAlign: "center", marginBottom: 24 }}>
        {t("loginMock.description")}
      </Text>
      <PrimaryButton
        label={t("loginMock.cta")}
        onPress={onLogin}
        accessibilityHint={t("loginMock.ctaHint")}
      />
    </View>
  );
}
