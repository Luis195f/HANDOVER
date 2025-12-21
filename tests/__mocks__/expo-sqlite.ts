import { vi } from 'vitest';

const createDb = () => ({
  execAsync: vi.fn(async () => []),
  runAsync: vi.fn(async () => ({
    rows: [],
    rowsAffected: 0,
    insertId: null,
  })),
  getAllAsync: vi.fn(async () => []),
  getFirstAsync: vi.fn(async () => undefined),
  withTransactionAsync: vi.fn(async (callback?: () => unknown) => callback?.()),
  closeAsync: vi.fn(async () => {}),
});

export const openDatabase = vi.fn(() => createDb());
export const openDatabaseAsync = vi.fn(async () => createDb());
export const openDatabaseSync = vi.fn(() => createDb());

const mod = {
  openDatabase,
  openDatabaseAsync,
  openDatabaseSync,
};

export default mod;
