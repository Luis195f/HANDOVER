import { afterEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

import {
  MAX_ATTEMPTS,
  OFFLINE_QUEUE_KEY,
  RETRY_DELAYS_MS,
  clearAll,
  enqueueTx,
  flushQueue,
  readQueue,
  type SendFn,
} from '@/src/lib/offlineQueue';

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

describe('offlineQueue retries y timestamps', () => {
  it('inicializa createdAt y metadatos de reintento', async () => {
    const item = await enqueueTx({ payload: { foo: 'bar' } });

    expect(typeof item.createdAt).toBe('number');
    expect(item.attempts).toBe(0);
    expect(item.lastAttemptAt).toBeUndefined();
    expect(item.failedAt).toBeUndefined();

    const [stored] = await readQueue();
    expect(stored.createdAt).toBe(item.createdAt);
    expect(stored.attempts).toBe(0);
    expect(stored.lastAttemptAt).toBeUndefined();
    expect(stored.failedAt).toBeUndefined();
  });

  it('incrementa attempts y marca lastAttemptAt en fallo', async () => {
    await enqueueTx({ payload: { fail: true } });
    const sender = vi.fn(async () => {
      throw new Error('network');
    });

    await flushQueue(sender);

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(typeof queue[0].lastAttemptAt).toBe('number');
    expect(queue[0].failedAt).toBeUndefined();
  });

  it('respeta el cooldown y no reintenta demasiado pronto', async () => {
    vi.useFakeTimers();
    const base = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(base);

    const item = await enqueueTx({ payload: { foo: 'bar' } });
    const stored = [
      {
        ...item,
        attempts: 1,
        tries: 1,
        lastAttemptAt: Date.now(),
      },
    ];
    await SecureStore.setItemAsync(OFFLINE_QUEUE_KEY, JSON.stringify(stored));

    const sender = vi.fn();
    await flushQueue(sender);

    expect(sender).not.toHaveBeenCalled();
    const queue = await readQueue();
    expect(queue[0].attempts).toBe(1);

    vi.useRealTimers();
  });

  it('marca failedAt al agotar reintentos y deja de reintentar', async () => {
    vi.useFakeTimers();
    const base = new Date('2024-01-02T00:00:00Z');
    vi.setSystemTime(base);

    const item = await enqueueTx({ payload: { foo: 'bar' } });
    const stored = [
      {
        ...item,
        attempts: MAX_ATTEMPTS - 1,
        tries: MAX_ATTEMPTS - 1,
        lastAttemptAt: Date.now() - (RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] + 100),
      },
    ];
    await SecureStore.setItemAsync(OFFLINE_QUEUE_KEY, JSON.stringify(stored));

    const sender = vi.fn(async () => {
      throw new Error('still failing');
    });

    await flushQueue(sender);
    expect(sender).toHaveBeenCalledTimes(1);

    let queue = await readQueue();
    expect(queue[0].attempts).toBe(MAX_ATTEMPTS);
    expect(queue[0].failedAt).toBeDefined();

    sender.mockClear();
    await flushQueue(sender);
    expect(sender).not.toHaveBeenCalled();

    queue = await readQueue();
    expect(queue[0].attempts).toBe(MAX_ATTEMPTS);

    vi.useRealTimers();
  });
});

describe('offlineQueue deduplicación y errores HTTP', () => {
  it('evita duplicados pendientes con misma dedupKey', async () => {
    await enqueueTx({ type: 'handoverBundle', dedupKey: 'handover:pat-001:shift-1', payload: { foo: 1 } });
    await enqueueTx({ type: 'handoverBundle', dedupKey: 'handover:pat-001:shift-1', payload: { foo: 2 } });

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
  });

  it('permite nuevo intento lógico si el previo está marcado como failedAt', async () => {
    const item = await enqueueTx({
      type: 'handoverBundle',
      dedupKey: 'handover:pat-002:shift-1',
      payload: { foo: 1 },
    });
    const failed = [{ ...item, failedAt: Date.now() }];
    await SecureStore.setItemAsync(OFFLINE_QUEUE_KEY, JSON.stringify(failed));

    await enqueueTx({ type: 'handoverBundle', dedupKey: 'handover:pat-002:shift-1', payload: { foo: 2 } });

    const queue = await readQueue();
    expect(queue).toHaveLength(2);
    expect(queue.map((q) => q.dedupKey)).toEqual([
      'handover:pat-002:shift-1',
      'handover:pat-002:shift-1',
    ]);
  });

  it('marca failedAt en errores 4xx y no reintenta', async () => {
    await enqueueTx({ payload: { fail: 'client' } });
    const sender = vi.fn(async () => ({ ok: false, status: 400 }));

    await flushQueue(sender);
    await flushQueue(sender);

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].failedAt).toBeDefined();
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('reintenta en errores 5xx sin marcar failedAt hasta agotar reintentos', async () => {
    await enqueueTx({ payload: { fail: 'server' } });
    const sender = vi.fn(async () => ({ ok: false, status: 500 }));

    await flushQueue(sender);

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(typeof queue[0].lastAttemptAt).toBe('number');
    expect(queue[0].failedAt).toBeUndefined();
  });
});

describe('offlineQueue flujo completo offline/online', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('mantiene las operaciones en cola cuando hay error de red', async () => {
    const payload = { patientId: 'pat-001', summary: 'Paciente estable' } as any;

    await enqueueTx({
      type: 'handoverBundle',
      payload,
      dedupKey: 'handover:pat-001:shift-1',
      sensitiveFields: ['patientId', 'summary'],
    });

    const sender = mockSendBundleAsNetworkError();

    await flushQueue(sender);

    const queue = await readQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0].payload).toEqual(payload);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastAttemptAt).toBeDefined();
    expect(queue[0].failedAt).toBeUndefined();
  });

  it('envía en orden FIFO y vacía la cola cuando la red se recupera', async () => {
    const first = { patientId: 'pat-001', summary: 'Primero' } as any;
    const second = { patientId: 'pat-002', summary: 'Segundo' } as any;

    await enqueueTx({
      type: 'handoverBundle',
      payload: first,
      dedupKey: 'handover:pat-001',
      sensitiveFields: ['patientId', 'summary'],
    });
    await enqueueTx({
      type: 'handoverBundle',
      payload: second,
      dedupKey: 'handover:pat-002',
      sensitiveFields: ['patientId', 'summary'],
    });

    const sendSpy = mockSendBundleAsSuccess();

    await flushQueue(sendSpy);

    const queue = await readQueue();
    expect(queue).toHaveLength(0);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[0]?.[0].payload).toEqual(first);
    expect(sendSpy.mock.calls[1]?.[0].payload).toEqual(second);
  });

  it('no envía duplicados cuando se usa dedupKey', async () => {
    const payload = { patientId: 'pat-003', summary: 'Duplicado' } as any;

    await enqueueTx({
      type: 'handoverBundle',
      payload,
      dedupKey: 'handover:pat-003',
      sensitiveFields: ['patientId', 'summary'],
    });
    await enqueueTx({
      type: 'handoverBundle',
      payload,
      dedupKey: 'handover:pat-003',
      sensitiveFields: ['patientId', 'summary'],
    });

    const sendSpy = mockSendBundleAsSuccess();

    await flushQueue(sendSpy);

    expect(sendSpy).toHaveBeenCalledTimes(1);

    const queue = await readQueue();
    expect(queue).toHaveLength(0);
  });

  it('marca 4xx como fallo definitivo pero procesa los siguientes items', async () => {
    const badPayload = { patientId: 'pat-bad', summary: 'Fallo 400' } as any;
    const okPayload = { patientId: 'pat-ok', summary: 'Debe enviarse' } as any;

    await enqueueTx({
      type: 'handoverBundle',
      payload: badPayload,
      dedupKey: 'handover:bad',
      sensitiveFields: ['patientId', 'summary'],
    });
    await enqueueTx({
      type: 'handoverBundle',
      payload: okPayload,
      dedupKey: 'handover:ok',
      sensitiveFields: ['patientId', 'summary'],
    });

    const sendSpy = mockSendBundleSequence([
      { ok: false, status: 400 },
      { ok: true, status: 200 },
    ]);

    await flushQueue(sendSpy);

    const queue = await readQueue();

    expect(queue.some((i) => i.payload.patientId === 'pat-bad' && i.failedAt)).toBe(true);
    expect(queue.some((i) => i.payload.patientId === 'pat-ok')).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });
});

function mockSendBundleAsNetworkError() {
  return vi.fn<Parameters<SendFn>, ReturnType<SendFn>>(async () => {
    throw new Error('Network error');
  });
}

function mockSendBundleAsSuccess() {
  return vi.fn<Parameters<SendFn>, ReturnType<SendFn>>(async () => ({ ok: true, status: 200 }));
}

function mockSendBundleSequence(responses: Array<{ ok: boolean; status: number }>) {
  const sendSpy = vi.fn<Parameters<SendFn>, ReturnType<SendFn>>();
  responses.forEach((res) => {
    sendSpy.mockResolvedValueOnce(res as Awaited<ReturnType<SendFn>>);
  });
  return sendSpy;
}
