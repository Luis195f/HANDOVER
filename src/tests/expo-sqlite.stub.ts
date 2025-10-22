// src/test/expo-sqlite.stub.ts
// Stub simple de expo-sqlite para entorno de tests (Vitest).
// Implementa las APIs comunes sin tocar nada nativo.

export type SQLiteChanges = { changes: number; lastInsertRowId: number };
export type SQLiteRow = Record<string, any>;

export type SQLiteDatabase = {
  execAsync: (queries: (string | [string, any[]])[], readOnly?: boolean) => Promise<void>;
  runAsync: (sql: string, ...params: any[]) => Promise<SQLiteChanges>;
  getAllAsync: (sql: string, ...params: any[]) => Promise<SQLiteRow[]>;
  closeAsync: () => Promise<void>;
};

function mkDb(): SQLiteDatabase {
  return {
    async execAsync(_queries: (string | [string, any[]])[], _readOnly?: boolean) {
      // no-op
    },
    async runAsync(_sql: string, ..._params: any[]): Promise<SQLiteChanges> {
      return { changes: 1, lastInsertRowId: Date.now() };
    },
    async getAllAsync(_sql: string, ..._params: any[]): Promise<SQLiteRow[]> {
      return [];
    },
    async closeAsync(): Promise<void> {
      // no-op
    },
  };
}

export async function openDatabaseAsync(_name?: string): Promise<SQLiteDatabase> {
  return mkDb();
}

export function openDatabaseSync(_name?: string): SQLiteDatabase {
  return mkDb();
}

// Compat con imports por defecto
export default { openDatabaseAsync, openDatabaseSync };
