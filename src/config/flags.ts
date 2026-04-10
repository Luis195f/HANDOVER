import { getAppConfigExtra } from "@/src/config/app-config";

type FlagValue = string | boolean | null | undefined;

const truthy = (v: FlagValue): boolean => {
  const s = String(v ?? "").trim().toLowerCase();
  return v === true || s === "1" || s === "true" || s === "yes" || s === "on";
};

const extra = getAppConfigExtra();

export const flags = {
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
    (extra as any)?.FEATURES?.handover?.showNocOutcomes ?? process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES ?? false,
  SHOW_HANDOVER_TIMING_METRICS:
    (extra as any)?.FEATURES?.handover?.showHandoverTimingMetrics ??
    process.env.EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS,
  ENABLE_ICEA_BRIDGE:
    (extra as any)?.FEATURES?.handover?.enableIceaBridge ?? process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE ?? false,
  ENABLE_ICEA_IMMEDIATE_SCORING:
    (extra as any)?.FEATURES?.handover?.enableIceaImmediateScoring ??
    process.env.EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING ?? false,
  ENABLE_ICEA_ENRICHED_SCORING:
    (extra as any)?.FEATURES?.handover?.enableIceaEnrichedScoring ??
    process.env.EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING ?? false,
  ENABLE_ICEA_PATIENT_RISK:
    (extra as any)?.FEATURES?.handover?.enableIceaPatientRisk ??
    process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK ?? false,
  ENABLE_ICEA_CAUSAL_SUMMARY:
    (extra as any)?.FEATURES?.handover?.enableIceaCausalSummary ??
    process.env.EXPO_PUBLIC_ENABLE_ICEA_CAUSAL_SUMMARY ?? false,
  HIDE_LEGACY_FIELDS:
    (extra as any)?.FEATURES?.handover?.hideLegacyFields ?? process.env.EXPO_PUBLIC_HIDE_LEGACY_FIELDS ?? false,
  REMOTE_CONFIG_DISABLED_FOR_NOW: (extra as any)?.FEATURES?.handover?.remoteConfigDisabled,
} satisfies Record<string, FlagValue>;

export const isOn = (k: keyof typeof flags) => truthy(flags[k]);
