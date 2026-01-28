import { secureGetItem, secureSetItem } from '@/src/security/secure-storage';

const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

const NS_RAW = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover';
const NS = (NS_RAW ?? 'handover').trim() || 'handover';

const PRIVACY_CONSENT_KEY = safeKey(`${NS}.privacy.consent.v1`);

export async function hasPrivacyConsent(): Promise<boolean> {
  try {
    const value = await secureGetItem(PRIVACY_CONSENT_KEY);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // no-op
  }
  return false;
}

export async function setPrivacyConsent(value: boolean): Promise<void> {
  try {
    await secureSetItem(PRIVACY_CONSENT_KEY, value ? 'true' : 'false');
  } catch {
    // no-op
  }
}
