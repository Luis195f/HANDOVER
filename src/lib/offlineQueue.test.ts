const secureStoreData = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => secureStoreData.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStoreData.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    secureStoreData.delete(key);
  }),
}));

import * as SecureStore from 'expo-secure-store';

import { OFFLINE_QUEUE_KEY, enqueueTx, readQueue, removeItem, clearAll, flushQueue, type SendFn } from './offlineQueue';

describe('offline queue', () => {
  beforeEach(async () => {
    secureStoreData.clear();
    jest.clearAllMocks();
  });

  it('enqueue → persiste item en cola cifrada', async () => {
    const it = await enqueueTx({ payload: { foo: 'bar' } });
    const raw = secureStoreData.get(OFFLINE_QUEUE_KEY) ?? '[]';
    const queue = JSON.parse(raw);
    expect(queue.some((entry: any) => entry.key === it.key)).toBe(true);
  });

  it('readQueue → devuelve en orden', async () => {
    const a = await enqueueTx({ payload: { a: 1 } });
    const b = await enqueueTx({ payload: { b: 2 } });
    const list = await readQueue();
    expect(list.map(i => i.key)).toEqual([a.key, b.key]);
  });

  it('removeItem → borra archivo', async () => {
    const it = await enqueueTx({ payload: { x: 1 } });
    expect(secureStoreData.has(OFFLINE_QUEUE_KEY)).toBe(true);
    await removeItem(it.key);
    const queue = secureStoreData.get(OFFLINE_QUEUE_KEY);
    expect(queue ? JSON.parse(queue) : []).toHaveLength(0);
  });

  it('clearAll → borra todos los .json', async () => {
    await enqueueTx({ payload: { one: 1 } });
    await enqueueTx({ payload: { two: 2 } });
    await clearAll();
    expect(secureStoreData.size).toBe(0);
  });

  it('flushQueue → borra en éxito 200 y 412; detiene en error', async () => {
    await enqueueTx({ payload: { ok: true } });
    await enqueueTx({ payload: { dup: true } });
    const i3 = await enqueueTx({ payload: { fail: true } });
    const i4 = await enqueueTx({ payload: { never: true } });

    const sender: SendFn = async (tx) => {
      if ((tx as any).payload.ok) return { ok: true, status: 200 };
      if ((tx as any).payload.dup) return { ok: false, status: 412 };
      return { ok: false, status: 500 };
    };

    await flushQueue(sender);

    const remaining = await readQueue();
    expect(remaining.map((it) => it.key)).toEqual([i3.key, i4.key]);
  });
});
