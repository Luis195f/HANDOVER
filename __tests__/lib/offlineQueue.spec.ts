import { afterEach, describe, expect, it } from 'vitest';
import * as SecureStore from 'expo-secure-store';

import { clearAll, enqueueTx, readQueue } from '@/src/lib/offlineQueue';

afterEach(async () => {
  await clearAll();
  (SecureStore as any).__reset?.();
});

describe('offlineQueue sensitiveFields', () => {
  it('marca campos sensibles cuando el payload contiene datos de paciente', async () => {
    const payload = {
      patientId: 'patient-123',
      summary: 'Paciente estable',
      vitals: { heartRate: 80 },
    };

    const item = await enqueueTx({ payload });
    expect(item.sensitiveFields).toEqual(expect.arrayContaining(['patientId', 'summary', 'vitals']));

    const [stored] = await readQueue();
    expect(stored.sensitiveFields).toEqual(expect.arrayContaining(['patientId', 'summary', 'vitals']));
  });

  it('no marca campos sensibles en payloads técnicos sin datos de paciente', async () => {
    const payload = { type: 'ping', timestamp: Date.now() };

    const item = await enqueueTx({ payload });

    expect(item.sensitiveFields ?? []).toHaveLength(0);
    const [stored] = await readQueue();
    expect(stored?.sensitiveFields ?? []).toHaveLength(0);
  });
});
