import Constants from 'expo-constants';

import { apiPost } from '@/src/lib/api';
import { hashHex } from '@/src/lib/crypto';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';

const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

const NS_RAW = process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover';
const NS = (NS_RAW ?? 'handover').trim() || 'handover';

const PRIVACY_CONSENT_KEY = safeKey(`${NS}.privacy.consent.v1`);

type ConsentAction = 'granted' | 'revoked';

export type PrivacyConsentRecord = {
  consent: boolean;
  timestamp: string;
  source?: string;
  revokedAt?: string;
  version: 1;
};

function parseConsentRecord(raw: string | null): PrivacyConsentRecord | null {
  if (!raw) return null;
  if (raw === 'true' || raw === 'false') {
    return {
      consent: raw === 'true',
      timestamp: new Date(0).toISOString(),
      version: 1,
    };
  }
  try {
    const parsed = JSON.parse(raw) as PrivacyConsentRecord;
    if (typeof parsed?.consent !== 'boolean' || typeof parsed?.timestamp !== 'string') return null;
    return { ...parsed, version: 1 };
  } catch {
    return null;
  }
}

export async function getPrivacyConsentRecord(): Promise<PrivacyConsentRecord | null> {
  try {
    const value = await secureGetItem(PRIVACY_CONSENT_KEY);
    return parseConsentRecord(value);
  } catch {
    return null;
  }
}

export async function hasPrivacyConsent(): Promise<boolean> {
  const record = await getPrivacyConsentRecord();
  return Boolean(record?.consent);
}

export async function setPrivacyConsent(
  value: boolean,
  options: { timestamp?: string; source?: string } = {},
): Promise<PrivacyConsentRecord | null> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const record: PrivacyConsentRecord = {
    consent: value,
    timestamp,
    source: options.source,
    revokedAt: value ? undefined : timestamp,
    version: 1,
  };
  try {
    await secureSetItem(PRIVACY_CONSENT_KEY, JSON.stringify(record));
    return record;
  } catch {
    // no-op
  }
  return null;
}

export async function revokePrivacyConsent(options: { timestamp?: string; source?: string } = {}): Promise<PrivacyConsentRecord | null> {
  return setPrivacyConsent(false, options);
}

export async function clearPrivacyConsent(): Promise<void> {
  try {
    await secureDeleteItem(PRIVACY_CONSENT_KEY);
  } catch {
    // no-op
  }
}

function buildConsentAuditPayload(record: PrivacyConsentRecord, action: ConsentAction) {
  const payload = JSON.stringify(record);
  const appVersion =
    Constants.expoConfig?.version ??
    (Constants as unknown as { manifest?: { version?: string } }).manifest?.version ??
    '';
  return {
    eventType: 'consent',
    timestamp: record.timestamp,
    action: action === 'granted' ? 'grant' : 'revoke',
    status: 'success',
    resourceType: 'Consent',
    resourceId: hashHex(`${record.timestamp}:${action}`, 24),
    payloadHash: hashHex(payload),
    payloadSize: payload.length,
    client: appVersion ? { appVersion } : undefined,
  };
}

export async function emitConsentAuditEvent(action: ConsentAction, record?: PrivacyConsentRecord | null): Promise<void> {
  const consentRecord = record ?? (await getPrivacyConsentRecord());
  if (!consentRecord) return;
  const payload = buildConsentAuditPayload(consentRecord, action);
  try {
    await apiPost('/api/audit/events', { body: JSON.stringify(payload) });
  } catch {
    // Best effort: no interrumpir UX
  }
}
