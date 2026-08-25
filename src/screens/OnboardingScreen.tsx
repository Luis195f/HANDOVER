import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  ListRenderItem,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { setOnboardingCompleted } from "@/src/lib/onboarding-storage";
import { confirmAction } from "@/src/lib/platform-confirm";
import { hasPrivacyConsent, setPrivacyConsent } from "@/src/lib/privacy-consent";
import type { RootStackParamList } from "@/src/navigation/types";
import { t, useTranslation } from "@/src/i18n";

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  icon: string;
};

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding"> & {
  onComplete?: () => Promise<void> | void;
  nextRoute?: keyof RootStackParamList;
  syntheticDemo?: boolean;
};

const { width } = Dimensions.get("window");

// BEGIN HANDOVER: ONBOARDING
const STEP_DEFS = [
  { id: "welcome", titleKey: "onboarding.steps.welcome.title", descriptionKey: "onboarding.steps.welcome.description", icon: "👋" },
  { id: "form", titleKey: "onboarding.steps.form.title", descriptionKey: "onboarding.steps.form.description", icon: "📋" },
  { id: "offline", titleKey: "onboarding.steps.offline.title", descriptionKey: "onboarding.steps.offline.description", icon: "📶" },
  { id: "qr", titleKey: "onboarding.steps.qr.title", descriptionKey: "onboarding.steps.qr.description", icon: "🎯" },
  { id: "sync", titleKey: "onboarding.steps.sync.title", descriptionKey: "onboarding.steps.sync.description", icon: "🔒" },
];
// END HANDOVER: ONBOARDING

export default function OnboardingScreen({
  navigation,
  onComplete,
  nextRoute = "PatientList",
  syntheticDemo = false,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const listRef = useRef<FlatList<OnboardingStep> | null>(null);
  const [consent, setConsent] = useState(false);
  const { i18n } = useTranslation();
  const steps = useMemo<OnboardingStep[]>(
    () =>
      STEP_DEFS.filter((step) => !(syntheticDemo && step.id === "qr")).map((step) => ({
        id: step.id,
        title: t(step.titleKey),
        description: t(step.descriptionKey),
        icon: step.icon,
      })),
    [i18n.language, syntheticDemo],
  );

  const isLastStep = currentIndex >= steps.length - 1;

  useEffect(() => {
    let alive = true;
    async function loadConsent() {
      try {
        const storedConsent = await hasPrivacyConsent();
        if (alive) setConsent(storedConsent);
      } catch {
        if (alive) setConsent(false);
      }
    }
    void loadConsent();
    return () => {
      alive = false;
    };
  }, []);

  const requireConsent = (): boolean => {
    if (consent) return true;
    Alert.alert(t("onboarding.consentRequiredTitle"), t("onboarding.consentRequiredMessage"));
    return false;
  };

  const handleComplete = async () => {
    if (!requireConsent()) return;
    await setPrivacyConsent(true);
    await setOnboardingCompleted(true);
    navigation.reset({ index: 0, routes: [{ name: nextRoute }] });
    if (onComplete) await onComplete();
  };

  const handleSkip = async () => {
    if (!requireConsent()) return;
    const confirmed = await confirmAction({
      title: t("onboarding.skipConfirmTitle"),
      message: t("onboarding.skipConfirmMessage"),
      confirmText: t("onboarding.skipConfirmAction"),
      cancelText: t("common.cancel"),
    });
    if (!confirmed) return;
    await handleComplete();
  };

  const handleNext = async () => {
    if (isLastStep) {
      await handleComplete();
      return;
    }
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
  };

  const indicators = useMemo(
    () =>
      steps.map((_, index) => (
        <View key={index} style={[styles.indicator, index === currentIndex && styles.indicatorActive]} />
      )),
    [currentIndex, steps]
  );

  const renderItem: ListRenderItem<OnboardingStep> = ({ item }) => (
    <View style={[styles.slide, { width }]}> 
      <View style={styles.iconContainer} accessibilityLabel="Ilustración de onboarding">
        <Text style={styles.icon}>{item.icon}</Text>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("onboarding.skipAccessibility")}
        onPress={handleSkip}
        style={styles.skipButton}
      >
        <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
      </Pressable>
      <FlatList
        ref={listRef}
        data={steps}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        renderItem={renderItem}
        extraData={currentIndex}
      />
      <View style={styles.footer}>
        <View style={styles.indicatorRow}>{indicators}</View>
        <View style={styles.consentContainer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate("PrivacyPolicy")}
            style={styles.policyButton}
          >
            <Text style={styles.policyButtonText}>{t("onboarding.viewPolicy")}</Text>
          </Pressable>
          <View style={styles.consentRow}>
            <Switch
              accessibilityLabel={t("onboarding.consentAccessibility")}
              value={consent}
              onValueChange={(value) => {
                setConsent(value);
                void setPrivacyConsent(value);
              }}
            />
            <View style={styles.consentTextContainer}>
              <Text style={styles.consentText}>{t("onboarding.consentText")}</Text>
              <Text style={styles.consentSubtext}>
                {t("onboarding.consentSubtext")}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLastStep ? t("onboarding.done") : t("onboarding.next")}
          onPress={handleNext}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            {isLastStep ? t("onboarding.done") : t("onboarding.next")}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B1120",
  },
  skipButton: {
    alignSelf: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  skipText: {
    color: "#CBD5E1",
    fontWeight: "600",
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1F2937",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  icon: {
    fontSize: 44,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#E2E8F0",
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: "#CBD5E1",
    textAlign: "center",
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
  },
  indicatorRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 16,
  },
  consentContainer: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  policyButton: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  policyButtonText: {
    color: "#38BDF8",
    fontWeight: "600",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  consentTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  consentText: {
    color: "#E2E8F0",
    fontWeight: "600",
    marginBottom: 4,
  },
  consentSubtext: {
    color: "#CBD5E1",
    fontSize: 12,
    lineHeight: 16,
  },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#1F2937",
    marginHorizontal: 6,
  },
  indicatorActive: {
    backgroundColor: "#38BDF8",
  },
  primaryButton: {
    backgroundColor: "#38BDF8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#0B1120",
    fontWeight: "700",
    fontSize: 16,
  },
});
