import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let queue: typeof import('@/src/lib/queue');
let sqlite: typeof import('../__mocks__/expo-sqlite');

describe('product queue on the synchronous Expo SQLite contract', () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', true);
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';
    sqlite = await import('../__mocks__/expo-sqlite');
    vi.doMock('expo-sqlite', () => sqlite);
    queue = await import('@/src/lib/queue');
  });

  beforeEach(() => sqlite.resetSQLiteMock());

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('expo-sqlite');
    delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
  });

  it('writes, reads, updates and deletes the canonical row through SQLite, not memory fallback', async () => {
    const created = await queue.enqueueOfflineQueueItem({ patientId: 'synthetic-patient', payload: { bundle: { marker: 'synthetic' } } });
    expect(sqlite.sqliteOperations.some(({ method, sql }) => method === 'runSync' && sql.includes('INSERT OR REPLACE INTO handover_offline_queue'))).toBe(true);

    const [raw] = await queue.getOfflineQueue({ decrypt: false });
    expect(raw?.id).toBe(created.id);
    expect(await queue.getOfflineQueueItem(created.id)).toMatchObject({ id: created.id, patientId: 'synthetic-patient' });
    await queue.updateOfflineQueueStatus(created.id, 'error', { errorStatus: 503 });
    const [updated] = await queue.getOfflineQueue({ decrypt: false });
    expect(updated).toMatchObject({ id: created.id, syncStatus: 'error', errorStatus: 503, payload: raw?.payload });
    expect(sqlite.sqliteOperations.some(({ method, sql }) => method === 'getFirstSync' && sql.includes('WHERE id=?'))).toBe(true);

    await queue.deleteOfflineQueueItem(created.id);
    expect(await queue.getOfflineQueue()).toEqual([]);
    expect(sqlite.sqliteOperations.some(({ method, sql }) => method === 'runSync' && sql === 'DELETE FROM handover_offline_queue WHERE id=?')).toBe(true);
  });

  it('keeps legacy transaction idempotency and retry metadata in SQL rows', async () => {
    await queue.enqueueTx({ key: 'synthetic-key', payload: { marker: 'first' } });
    await queue.enqueueTx({ key: 'synthetic-key', payload: { marker: 'second' } });
    expect(queue.getQueueLength()).toBe(1);
    expect((await queue.getQueueSnapshot())[0]?.payload).toMatchObject({ marker: 'first' });
    await queue.flushQueue(async () => ({ ok: false, status: 503 }), { maxRetries: 0, baseDelayMs: 0 });
    expect((await queue.__getRawTxQueueRows())[0]?.tries).toBe(1);
    expect(sqlite.sqliteOperations.some(({ method, sql }) => method === 'runSync' && sql.startsWith('UPDATE tx_queue SET tries='))).toBe(true);
    await queue.clearTxQueue();
    expect(queue.getQueueLength()).toBe(0);
  });
});
