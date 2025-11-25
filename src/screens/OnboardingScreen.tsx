import React, { useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  ListRenderItem,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { setOnboardingCompleted } from "@/src/lib/onboarding-storage";
import type { RootStackParamList } from "@/src/navigation/types";

type OnboardingStep = {
  title: string;
  description: string;
  icon: string;
};

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding"> & {
  onComplete?: () => Promise<void> | void;
  nextRoute?: keyof RootStackParamList;
};

const { width } = Dimensions.get("window");

// BEGIN HANDOVER: ONBOARDING
const STEPS: OnboardingStep[] = [
  {
    title: "Bienvenida a HANDOVER-Pro",
    description: "Organiza el pase de turno con seguridad y toda la información clave a mano.",
    icon: "👋",
  },
  {
    title: "Formulario estructurado",
    description: "Registra signos vitales, escalas NEWS2/Braden/Glasgow, dispositivos y tareas pendientes.",
    icon: "📋",
  },
  {
    title: "Borradores y modo offline",
    description: "Tus borradores se guardan cifrados y se sincronizan cuando vuelve la conexión.",
    icon: "📶",
  },
  {
    title: "Escaneo de QR del paciente",
    description: "Identifica al paciente rápidamente con la pulsera QR cuando la función esté disponible.",
    icon: "🎯",
  },
  {
    title: "Centro de sincronización",
    description: "Consulta la cola en SyncCenter. Enviamos datos con estándares FHIR para mayor seguridad.",
    icon: "🔒",
  },
];
// END HANDOVER: ONBOARDING

export default function OnboardingScreen({ navigation, onComplete, nextRoute = "PatientList" }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const listRef = useRef<FlatList<OnboardingStep> | null>(null);

  const isLastStep = currentIndex >= STEPS.length - 1;

  const handleComplete = async () => {
    await setOnboardingCompleted(true);
    if (onComplete) await onComplete();
    navigation.reset({ index: 0, routes: [{ name: nextRoute }] });
  };

  const handleSkip = async () => {
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
      STEPS.map((_, index) => (
        <View key={index} style={[styles.indicator, index === currentIndex && styles.indicatorActive]} />
      )),
    [currentIndex]
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
        accessibilityLabel="Saltar tutorial"
        onPress={handleSkip}
        style={styles.skipButton}
      >
        <Text style={styles.skipText}>Saltar</Text>
      </Pressable>
      <FlatList
        ref={listRef}
        data={STEPS}
        keyExtractor={(item) => item.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        renderItem={renderItem}
        extraData={currentIndex}
      />
      <View style={styles.footer}>
        <View style={styles.indicatorRow}>{indicators}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isLastStep ? "Entendido" : "Siguiente"}
          onPress={handleNext}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>{isLastStep ? "Entendido" : "Siguiente"}</Text>
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

