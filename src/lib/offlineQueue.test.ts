import { beforeEach, describe, expect, it } from 'vitest';

import { enqueueTx, readQueue, removeItem, clearAll, flushQueue, type SendFn } from './offlineQueue';

describe('offline queue', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('enqueue → persiste item', async () => {
    const it = await enqueueTx({ payload: { foo: 'bar' } });
    const queue = await readQueue();
    expect(queue.some((entry) => entry.key === it.key)).toBe(true);
  });

  it('readQueue → devuelve en orden', async () => {
    const a = await enqueueTx({ payload: { a: 1 } });
    const b = await enqueueTx({ payload: { b: 2 } });
    const list = await readQueue();
    expect(list.map(i => i.key)).toEqual([a.key, b.key]);
  });

  it('removeItem → elimina un item', async () => {
    const it = await enqueueTx({ payload: { x: 1 } });
    await removeItem(it.key);
    const queue = await readQueue();
    expect(queue).toHaveLength(0);
  });

  it('clearAll → borra la cola', async () => {
    await enqueueTx({ payload: { one: 1 } });
    await enqueueTx({ payload: { two: 2 } });
    await clearAll();
    expect(await readQueue()).toHaveLength(0);
  });

  it('flushQueue → borra en éxito 200 y 412; mantiene errores', async () => {
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
