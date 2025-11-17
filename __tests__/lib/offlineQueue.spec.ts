import { afterEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

import { OFFLINE_QUEUE_KEY, clearAll, enqueueTx, readQueue } from '@/src/lib/offlineQueue';

afterEach(async () => {
  await clearAll();
  const resettable = SecureStore as { __reset?: () => void };
  resettable.__reset?.();
  vi.restoreAllMocks();
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

  it('persiste la cola cifrada con SecureStore', async () => {
    const setItemSpy = vi.spyOn(SecureStore, 'setItemAsync');
    await enqueueTx({ payload: { foo: 'bar' } });

    expect(setItemSpy).toHaveBeenCalled();
    const lastCall = setItemSpy.mock.calls.pop();
    expect(lastCall?.[0]).toBe(OFFLINE_QUEUE_KEY);
    expect(typeof lastCall?.[1]).toBe('string');
    expect((lastCall?.[1] as string)?.length ?? 0).toBeGreaterThan(0);
  });

  it('persiste y recupera la cola offline mediante SecureStore (round-trip)', async () => {
    const payload = {
      patientId: 'pat-001',
      summary: 'Paciente estable, monitorizar',
      vitals: { heartRate: 80 },
    };

    const setItemSpy = vi.spyOn(SecureStore, 'setItemAsync');

    await enqueueTx({ payload });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);

    const item = queue[0];
    expect(item.payload).toEqual(payload);

    expect(setItemSpy).toHaveBeenCalledWith(OFFLINE_QUEUE_KEY, expect.any(String));
  });

  it('devuelve cola vacía si el contenido cifrado está corrupto', async () => {
    const getItemSpy = vi.spyOn(SecureStore, 'getItemAsync');
    getItemSpy.mockResolvedValueOnce('NOT_JSON');

    const queue = await readQueue();

    expect(queue).toEqual([]);
  });

  it('mantiene los metadatos sensitiveFields tras cifrar y leer la cola', async () => {
    const payload = {
      patientId: 'pat-002',
      summary: 'Paciente con riesgo',
    };

    const item = await enqueueTx({ payload });
    const fromStorage = await readQueue();

    expect(fromStorage[0].sensitiveFields).toEqual(item.sensitiveFields);
  });
});
