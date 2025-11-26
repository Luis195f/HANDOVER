import { secureGetItem, secureSetItem } from "@/src/security/secure-storage";

const STORAGE_NAMESPACE = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? "handover";
const ONBOARDING_KEY = `${STORAGE_NAMESPACE}:onboarding.completed.v1`;

export async function getOnboardingCompleted(): Promise<boolean> {
  try {
    const value = await secureGetItem(ONBOARDING_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch (error) {
    if (__DEV__) console.warn("[onboarding] Failed to read completion flag", error);
  }
  return false;
}

export async function setOnboardingCompleted(value: boolean): Promise<void> {
  try {
    await secureSetItem(ONBOARDING_KEY, value ? "true" : "false");
  } catch (error) {
    if (__DEV__) console.warn("[onboarding] Failed to persist completion flag", error);
  }
}
