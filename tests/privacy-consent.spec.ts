import { describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

vi.mock('@/src/lib/api', () => ({
  apiPost: vi.fn(async () => ({})),
}));

import { emitConsentAuditEvent, getPrivacyConsentRecord, hasPrivacyConsent, setPrivacyConsent } from '@/src/lib/privacy-consent';
import { apiPost } from '@/src/lib/api';

describe('privacy consent storage', () => {
  it('stores consent record with timestamp', async () => {
    (SecureStore as typeof SecureStore & { __reset?: () => void }).__reset?.();

    const record = await setPrivacyConsent(true, {
      timestamp: '2024-01-01T00:00:00.000Z',
      source: 'test',
    });

    const stored = await getPrivacyConsentRecord();
    expect(record?.consent).toBe(true);
    expect(stored?.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(await hasPrivacyConsent()).toBe(true);
  });

  it('sends consent audit event', async () => {
    const record = await setPrivacyConsent(true, {
      timestamp: '2024-02-01T00:00:00.000Z',
      source: 'test',
    });

    await emitConsentAuditEvent('granted', record);

    const payload = (apiPost as unknown as { mock: { calls: any[] } }).mock.calls[0][1]?.body as string;
    const parsed = JSON.parse(payload);

    expect(parsed.eventType).toBe('consent');
    expect(parsed.action).toBe('grant');
    expect(parsed.status).toBe('success');
  });
});
