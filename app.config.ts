import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: "handover-pro",
  slug: "handover-pro",
  owner: "enfermero1",

  scheme: "handoverpro",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",

  icon: "./assets/icon.png",

  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },

  // ────────────────────────────────────────────────
  // 📦 Plugins compatibles con Expo SDK 54 (limpio)
  // ────────────────────────────────────────────────
  plugins: [
    "expo-system-ui",
    "expo-sqlite",
    "expo-secure-store",
    "expo-notifications",
    [
      "expo-audio",
      {
        microphonePermission: "Permitir a Handover usar el micrófono.",
      },
    ],
    "expo-asset",
    [
      "expo-build-properties",
      {
        android: {
          kotlinVersion: "2.0.21",
        },
      },
    ],
  ],

  // ────────────────────────────────────────────────
  // 🤖 ANDROID CONFIG
  // ────────────────────────────────────────────────
  android: {
    package: "com.handover.app", // ID limpio para producción
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ],
    versionCode: 1,
    edgeToEdgeEnabled: true,
  },

  // ────────────────────────────────────────────────
  // 🍏 iOS CONFIG
  // ────────────────────────────────────────────────
  ios: {
    bundleIdentifier: "com.handover.app",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        "Se requiere la cámara para escanear códigos QR en Handover.",
      NSMicrophoneUsageDescription:
        "Grabación de notas de audio del turno.",
      NSUserTrackingUsageDescription:
        "Se usa para mejorar la experiencia del turno.",
    },
    buildNumber: "1.0.0",
  },

  // ────────────────────────────────────────────────
  // ⚙️ EXTRA ENVIRONMENT & FEATURES
  // ────────────────────────────────────────────────
  extra: {
    eas: {
      projectId: "4341b7e0-da12-42a3-8452-745c68996e36",
    },
    FHIR_BASE_URL: "https://fhir.example.com",
    STT_ENDPOINT: "http://192.168.0.16:8091/stt",
    ENCRYPTION_NAMESPACE: "handover-pro",
    ALLOW_ALL_UNITS: "1",
    FEATURES: {
      handover: {
        showSBAR: "1",
        showVitals: "1",
        showOxygen: "1",
        showMeds: "1",
        showAttachments: "1",
        enableAlerts: "1",
      },
    },
  },

  // ────────────────────────────────────────────────
  // 🔄 UPDATES (EAS UPDATE & OTA READY)
  // ────────────────────────────────────────────────
  updates: {
    fallbackToCacheTimeout: 0,
    checkAutomatically: "ON_LOAD",
  },
});







