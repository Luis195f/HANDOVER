// app.config.ts
// ================================================
// ✅ HANDOVER-PRO – Configuración integral de Expo
// Compatible con EAS Build, Router y FHIR modules
// ================================================

import { ExpoConfig, ConfigContext } from "expo/config";
import appJson from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const expo = config ?? {};

  return {
    ...expo,
    name: appJson.expo?.name ?? "handover-pro",
    slug: appJson.expo?.slug ?? "handover-pro",
    version: appJson.expo?.version ?? "1.0.0",

    // ============================================
    // 📱 HANDOVER: CONFIGURACIÓN ANDROID MÍNIMA
    // ============================================
    android: {
      ...(expo.android ?? {}),
      package: "com.handover.app",
      permissions: Array.from(
        new Set([
          ...(expo?.android?.permissions ?? []),
          "CAMERA",
          "RECORD_AUDIO",
          "READ_EXTERNAL_STORAGE",
          "WRITE_EXTERNAL_STORAGE",
          "INTERNET",
        ])
      ),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
    },

    // ============================================
    // 🍎 HANDOVER: CONFIGURACIÓN iOS
    // ============================================
    ios: {
      ...(expo.ios ?? {}),
      bundleIdentifier: "com.handover.app",
      supportsTablet: true,
      infoPlist: {
        NSCameraUsageDescription:
          "La cámara se usa para escanear códigos QR de pacientes y registros clínicos.",
        NSMicrophoneUsageDescription:
          "El micrófono se usa para grabar notas de voz en el pase de turno.",
      },
    },

    // ============================================
    // 🔄 HANDOVER: ACTUALIZACIONES OTA (EAS)
    // ============================================
    updates: {
      ...(expo.updates ?? {}),
      url: "https://u.expo.dev/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", // 🔁 reemplaza con tu ID de proyecto Expo
      enabled: true,
      checkAutomatically: "ON_LOAD",
    },

    runtimeVersion: {
      policy: "sdkVersion",
    },

    // ============================================
    // 🧩 HANDOVER: PLUGINS (Expo Router y otros)
    // ============================================
    plugins: [
      ...(expo.plugins ?? []),
      "expo-router", // necesario para navegación basada en rutas
      "expo-camera",
      "expo-notifications",
      "expo-secure-store",
      "expo-sqlite",
    ],

    // ============================================
    // 🌐 DEEP LINKS / LINKING
    // ============================================
    scheme: "handover",
    extra: {
      eas: {
        projectId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", // 🔁 reemplaza con tu ID real de EAS Project
      },
    },

    // ============================================
    // 🧠 MISC (seguridad, idioma, etc.)
    // ============================================
    orientation: "portrait",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
  };
};







