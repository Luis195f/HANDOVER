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

import { enqueueTx, readQueue, removeItem, clearAll, flushQueue, type SendFn, QUEUE_DIR } from './offlineQueue';

describe('offline queue', () => {
  beforeEach(async () => {
    secureStoreData.clear();
    jest.clearAllMocks();
  });

  it('enqueue → persiste item e índice', async () => {
    const it = await enqueueTx({ payload: { foo: 'bar' } });
    const path = `${QUEUE_DIR}:${it.key}`;
    expect(secureStoreData.has(path)).toBe(true);
    const idxRaw = secureStoreData.get(`${QUEUE_DIR}:__index__`);
    expect(idxRaw ? JSON.parse(idxRaw) : []).toContain(it.key);
  });

  it('readQueue → devuelve en orden', async () => {
    const a = await enqueueTx({ payload: { a: 1 } });
    const b = await enqueueTx({ payload: { b: 2 } });
    const list = await readQueue();
    expect(list.map(i => i.key)).toEqual([a.key, b.key]);
  });

  it('removeItem → borra archivo', async () => {
    const it = await enqueueTx({ payload: { x: 1 } });
    const path = `${QUEUE_DIR}:${it.key}`;
    expect(secureStoreData.has(path)).toBe(true);
    await removeItem(it.key);
    expect(secureStoreData.has(path)).toBe(false);
  });

  it('clearAll → borra todos los .json', async () => {
    await enqueueTx({ payload: { one: 1 } });
    await enqueueTx({ payload: { two: 2 } });
    await clearAll();
    const storedKeys = Array.from(secureStoreData.keys()).filter((k) => k.startsWith(QUEUE_DIR));
    expect(storedKeys.length).toBe(0);
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
