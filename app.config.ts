import type { ExpoConfig } from "expo/config";

const appJson = require("./app.json");

const config: ExpoConfig = {
  ...appJson,
  expo: {
    ...appJson.expo,
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
