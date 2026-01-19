// src/lib/onboarding-storage.ts
import { secureGetItem, secureSetItem } from "@/src/security/secure-storage";

const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_");

const NS_RAW = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? "handover";
const NS = (NS_RAW ?? "handover").trim() || "handover";

// usa "." en vez de ":" y sanitiza
const ONBOARDING_KEY = safeKey(`${NS}.onboarding.completed.v1`);


export async function getOnboardingCompleted(): Promise<boolean> {
  try {
    const value = await secureGetItem(ONBOARDING_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
  }
  return false;
}

export async function setOnboardingCompleted(value: boolean): Promise<void> {
  try {
    await secureSetItem(ONBOARDING_KEY, value ? "true" : "false");
  } catch {
  }
}
