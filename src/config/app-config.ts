import Constants from "expo-constants";

export type Boolish = boolean | "1" | "true" | "yes" | undefined | null;

export type HandoverFeatureFlags = {
  handover?: {
    showSBAR?: Boolish;
    showVitals?: Boolish;
    showOxygen?: Boolish;
    showMeds?: Boolish;
    showAttachments?: Boolish;
    enableAlerts?: Boolish;
    aiSuggestions?: Boolish;
    remoteConfigDisabled?: Boolish;
  };
};

export type AppConfigExtra = {
  ALLOW_ALL_UNITS?: Boolish;
  HANDOVER_DEPLOYMENT_MODE?: string;
  HANDOVER_PILOT_CONTROL_JSON?: string;
  FEATURES?: HandoverFeatureFlags;
} & Record<string, unknown>;

type ExpoConfigLike = { extra?: AppConfigExtra | null };
type ExpoConstantsLike = { expoConfig?: ExpoConfigLike | null; manifest?: ExpoConfigLike | null };

export const getAppConfigExtra = (): AppConfigExtra => {
  const constants = Constants as unknown as ExpoConstantsLike;
  return constants.expoConfig?.extra ?? constants.manifest?.extra ?? {};
};
