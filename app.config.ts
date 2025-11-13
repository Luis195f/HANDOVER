import type { ExpoConfig } from "expo/config";

const appJson = require("./app.json");
const expo = appJson.expo ?? {};

const config: ExpoConfig = {
  ...appJson,
  expo: {
    ...appJson.expo,
    // BEGIN HANDOVER: PERMISSIONS_MIN
    ios: { ...(expo.ios||{}), infoPlist: { ...(expo?.ios?.infoPlist||{}),
      NSCameraUsageDescription: "Escaneo de QR para identificar paciente",
      NSMicrophoneUsageDescription: "Dictado de notas clínicas"
    }},
    android: { ...(expo.android||{}), permissions: Array.from(new Set([...(expo?.android?.permissions||[]), "CAMERA","RECORD_AUDIO"])) }
    // END HANDOVER: PERMISSIONS_MIN
    plugins: [
      ...(appJson.expo?.plugins ?? []),
      // BEGIN HANDOVER: SENTRY_PLUGIN
      [
        "sentry-expo",
        { organization: "PLACEHOLDER_ORG", project: "handover" }
      ]
      // END HANDOVER: SENTRY_PLUGIN
    ]
  }
};

export default config;
