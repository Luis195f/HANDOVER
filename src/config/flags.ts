import { getAppConfigExtra } from "@/src/config/app-config";

type FlagValue = string | boolean | null | undefined;

const truthy = (v: FlagValue): boolean => {
  const s = String(v ?? "").trim().toLowerCase();
  return v === true || s === "1" || s === "true" || s === "yes" || s === "on";
};

const extra = getAppConfigExtra();

export const flags = {
  ALLOW_ALL_UNITS: (extra as any)?.ALLOW_ALL_UNITS ?? process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS,
  SHOW_SBAR: (extra as any)?.FEATURES?.handover?.showSBAR ?? process.env.EXPO_PUBLIC_SHOW_SBAR,
  SHOW_VITALS: (extra as any)?.FEATURES?.handover?.showVitals ?? process.env.EXPO_PUBLIC_SHOW_VITALS,
  SHOW_OXY: (extra as any)?.FEATURES?.handover?.showOxygen ?? process.env.EXPO_PUBLIC_SHOW_OXY,
  SHOW_MEDS: (extra as any)?.FEATURES?.handover?.showMeds ?? process.env.EXPO_PUBLIC_SHOW_MEDS,
  SHOW_ATTACH: (extra as any)?.FEATURES?.handover?.showAttachments ?? process.env.EXPO_PUBLIC_SHOW_ATTACH,
  ENABLE_ALERTS: (extra as any)?.FEATURES?.handover?.enableAlerts ?? process.env.EXPO_PUBLIC_ENABLE_ALERTS,
  AI_SUGGESTIONS_ENABLED:
    (extra as any)?.FEATURES?.handover?.aiSuggestions ?? process.env.EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED,
  SHOW_NIC_CODING:
    (extra as any)?.FEATURES?.handover?.showNicCoding ?? process.env.EXPO_PUBLIC_SHOW_NIC_CODING ?? false,
  SHOW_NOC_OUTCOMES:
    (extra as any)?.FEATURES?.handover?.showNocOutcomes ?? process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES,
  SHOW_HANDOVER_TIMING_METRICS:
    (extra as any)?.FEATURES?.handover?.showHandoverTimingMetrics ??
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS,
  HIDE_LEGACY_FIELDS:
    (extra as any)?.FEATURES?.handover?.hideLegacyFields ?? process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS ?? false,
  REMOTE_CONFIG_DISABLED_FOR_NOW: (extra as any)?.FEATURES?.handover?.remoteConfigDisabled,
} satisfies Record<string, FlagValue>;

export const isOn = (k: keyof typeof flags) => truthy(flags[k]);

