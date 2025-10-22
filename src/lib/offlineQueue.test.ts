import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { enqueueTx, readQueue, removeItem, clearAll, flushQueue, type SendFn, QUEUE_DIR } from './offlineQueue';

vi.mock('expo-secure-store');
vi.mock('expo-file-system');

const mockFS: Record<string, string> = {};
(FileSystem.readDirectoryAsync as any).mockImplementation(async (dir: string) =>
  Object.keys(mockFS)
    .filter(p => p.startsWith(dir))
    .map(p => p.substring(dir.length))
);
(FileSystem.getInfoAsync as any).mockImplementation(async (path: string) => ({ exists: path in mockFS }));
(FileSystem.makeDirectoryAsync as any).mockResolvedValue(undefined);
(FileSystem.deleteAsync as any).mockImplementation(async (path: string) => { delete mockFS[path]; });
(FileSystem.writeAsStringAsync as any).mockImplementation(async (path: string, content: string) => { mockFS[path] = content; });
(FileSystem.readAsStringAsync as any).mockImplementation(async (path: string) => mockFS[path]);

(SecureStore.getItemAsync as any).mockResolvedValue(undefined);
(SecureStore.setItemAsync as any).mockResolvedValue(undefined);

describe('offline queue', () => {
  beforeEach(async () => {
    for (const k of Object.keys(mockFS)) delete mockFS[k];
    (SecureStore.getItemAsync as any).mockReset();
    (SecureStore.getItemAsync as any).mockResolvedValue(undefined);
  });

  it('enqueue → escribe archivo cifrado en QUEUE_DIR', async () => {
    const it = await enqueueTx({ foo: 'bar' });
    const path = `${QUEUE_DIR}${it.key}.json`;
    expect(mockFS[path]).toBeTruthy();
  });

  it('readQueue → devuelve en orden', async () => {
    const a = await enqueueTx({ a: 1 });
    const b = await enqueueTx({ b: 2 });
    const list = await readQueue();
    expect(list.map(i => i.key)).toEqual([a.key, b.key]);
  });

  it('removeItem → borra archivo', async () => {
    const it = await enqueueTx({ x: 1 });
    const path = `${QUEUE_DIR}${it.key}.json`;
    expect(mockFS[path]).toBeTruthy();
    await removeItem(it.key);
    expect(mockFS[path]).toBeFalsy();
  });

  it('clearAll → borra todos los .json', async () => {
    await enqueueTx({ one: 1 });
    await enqueueTx({ two: 2 });
    await clearAll();
    const files = Object.keys(mockFS).filter(p => p.startsWith(QUEUE_DIR));
    expect(files.length).toBe(0);
  });

  it('flushQueue → borra en éxito 200 y 412; detiene en error', async () => {
    const i1 = await enqueueTx({ ok: true });
    const i2 = await enqueueTx({ dup: true });
    const i3 = await enqueueTx({ fail: true });
    const i4 = await enqueueTx({ never: true });

    const sender: SendFn = async (tx) => {
      if ((tx as any).payload.ok) return { ok: true, status: 200 };
      if ((tx as any).payload.dup) return { ok: false, status: 412 };
      return { ok: false, status: 500 };
    };

    await flushQueue(sender);

    expect(await readQueue()).toEqual([i3, i4]);
  });
});
