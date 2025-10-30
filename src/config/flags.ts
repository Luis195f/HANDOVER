import Constants from 'expo-constants';

type Bool = boolean | '1' | 'true' | 'yes' | undefined | null;
const truthy = (v: Bool) =>
  String(v ?? '').toLowerCase() === '1' ||
  v === true ||
  String(v).toLowerCase() === 'true' ||
  String(v).toLowerCase() === 'yes';

const extra = (Constants.expoConfig?.extra ?? {}) as any;

export const flags = {
  ALLOW_ALL_UNITS: extra.ALLOW_ALL_UNITS ?? process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS,
  SHOW_SBAR: extra.FEATURES?.handover?.showSBAR ?? process.env.EXPO_PUBLIC_SHOW_SBAR,
  SHOW_VITALS: extra.FEATURES?.handover?.showVitals ?? process.env.EXPO_PUBLIC_SHOW_VITALS,
  SHOW_OXY: extra.FEATURES?.handover?.showOxygen ?? process.env.EXPO_PUBLIC_SHOW_OXY,
  SHOW_MEDS: extra.FEATURES?.handover?.showMeds ?? process.env.EXPO_PUBLIC_SHOW_MEDS,
  SHOW_ATTACH: extra.FEATURES?.handover?.showAttachments ?? process.env.EXPO_PUBLIC_SHOW_ATTACH,
  ENABLE_ALERTS: extra.FEATURES?.handover?.enableAlerts ?? process.env.EXPO_PUBLIC_ENABLE_ALERTS,
};

export const isOn = (k: keyof typeof flags) => truthy(flags[k]);
