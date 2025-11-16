import type { ExpoConfig } from "expo/config";

const appJson = require("./app.json");

const expo = appJson.expo ?? {};
const easProjectId = expo?.extra?.eas?.projectId;

const config: ExpoConfig = ((expo) => {
  return {
    ...expo,
    name: expo?.name ?? "handover-pro",
    slug: expo?.slug ?? "handover-pro",

    // === EAS Update: runtimeVersion requerido ===
    runtimeVersion: expo.runtimeVersion ?? { policy: "appVersion" },

    // BEGIN HANDOVER: ANDROID_CONFIG
    android: {
      ...(expo.android ?? {}),
      package: expo.android?.package ?? "com.anonymous.handoverpro",
      adaptiveIcon: {
        ...(expo.android?.adaptiveIcon ?? {}),
        foregroundImage:
          expo.android?.adaptiveIcon?.foregroundImage ??
          "./assets/adaptive-icon.png",
        backgroundColor:
          expo.android?.adaptiveIcon?.backgroundColor ?? "#ffffff",
      },
      permissions: Array.from(
        new Set([
          ...(expo.android?.permissions ?? []),
          "android.permission.CAMERA",
          "android.permission.RECORD_AUDIO",
          "android.permission.POST_NOTIFICATIONS",
          "android.permission.MODIFY_AUDIO_SETTINGS",
        ])
      ),
      edgeToEdgeEnabled: expo.android?.edgeToEdgeEnabled ?? true,
    },
    // END HANDOVER: ANDROID_CONFIG

    // BEGIN HANDOVER: IOS_CONFIG
    ios: {
      ...(expo.ios ?? {}),
      supportsTablet: expo.ios?.supportsTablet ?? true,
      infoPlist: {
        ...(expo.ios?.infoPlist ?? {}),
        NSCameraUsageDescription:
          expo.ios?.infoPlist?.NSCameraUsageDescription ??
          "Se requiere la cámara para escanear códigos QR en Handover.",
        NSMicrophoneUsageDescription:
          expo.ios?.infoPlist?.NSMicrophoneUsageDescription ??
          "Grabación de notas de audio del turno",
        NSUserTrackingUsageDescription:
          expo.ios?.infoPlist?.NSUserTrackingUsageDescription ??
          "Se usa para mejorar la experiencia del turno",
      },
    },
    // END HANDOVER: IOS_CONFIG

    // BEGIN HANDOVER: EXTRA_MERGE
    extra: {
      ...(expo.extra ?? {}),
      eas: {
        ...(expo.extra?.eas ?? {}),
        projectId: easProjectId,
      },
      FEATURES: {
        ...(expo.extra?.FEATURES ?? {}),
        handover: {
          ...(expo.extra?.FEATURES?.handover ?? {}),
        },
      },
    },
    // END HANDOVER: EXTRA_MERGE

    // BEGIN HANDOVER: SPLASH_DEFAULTS
    splash: {
      image: expo.splash?.image ?? "./assets/splash-icon.png",
      resizeMode: expo.splash?.resizeMode ?? "contain",
      backgroundColor: expo.splash?.backgroundColor ?? "#ffffff",
    },
    // END HANDOVER: SPLASH_DEFAULTS

    // BEGIN HANDOVER: UPDATES_URL
    updates: {
      ...(expo.updates ?? {}),
      ...(easProjectId
        ? { url: `https://u.expo.dev/${easProjectId}` }
        : {}),
    },
    // END HANDOVER: UPDATES_URL

    // Plugins: usamos exactamente los definidos en app.json
    plugins: expo.plugins ?? [],
  };
})(expo);

export default config;


