import { vi } from 'vitest';

type SqlRow = Record<string, unknown>;
type SqlOperation = { method: 'execSync' | 'runSync' | 'getAllSync' | 'getFirstSync'; sql: string; params: unknown[] };

const offlineRows = new Map<string, SqlRow>();
const transactionRows = new Map<string, SqlRow>();
export const sqliteOperations: SqlOperation[] = [];

export function resetSQLiteMock(): void {
  offlineRows.clear();
  transactionRows.clear();
  sqliteOperations.length = 0;
}

const record = (method: SqlOperation['method'], sql: string, params: unknown[] = []) => {
  sqliteOperations.push({ method, sql, params });
  return sql.trim().replace(/\s+/g, ' ').toUpperCase();
};

const createDb = () => ({
  execSync: vi.fn((sql: string) => {
    const statement = record('execSync', sql);
    if (statement.startsWith('CREATE TABLE IF NOT EXISTS TX_QUEUE') ||
        statement.startsWith('CREATE TABLE IF NOT EXISTS HANDOVER_OFFLINE_QUEUE') ||
        statement.startsWith('ALTER TABLE TX_QUEUE ADD COLUMN') ||
        statement.startsWith('ALTER TABLE HANDOVER_OFFLINE_QUEUE ADD COLUMN')) return;
    throw new Error(`Unsupported SQLite exec: ${statement}`);
  }),
  runSync: vi.fn((sql: string, params: unknown[] = []) => {
    const statement = record('runSync', sql, params);
    if (statement.startsWith('INSERT OR REPLACE INTO HANDOVER_OFFLINE_QUEUE(')) {
      const columns = ['id', 'created_at', 'first_enqueued_at', 'last_attempt_at', 'attempts', 'attempt_count', 'sync_status', 'error_message', 'error_status', 'error_issues_json', 'payload_type', 'payload', 'patient_id'];
      const row = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
      offlineRows.set(String(row.id), row);
      return;
    }
    if (statement.startsWith('INSERT OR IGNORE INTO TX_QUEUE(')) {
      const [key, payload, tries, nextAt, createdAt] = params;
      if (!transactionRows.has(String(key))) transactionRows.set(String(key), { key, payload, tries, next_at: nextAt, created_at: createdAt });
      return;
    }
    if (statement === 'DELETE FROM HANDOVER_OFFLINE_QUEUE') { offlineRows.clear(); return; }
    if (statement === 'DELETE FROM TX_QUEUE') { transactionRows.clear(); return; }
    if (statement === 'DELETE FROM HANDOVER_OFFLINE_QUEUE WHERE ID=?') { offlineRows.delete(String(params[0])); return; }
    if (statement === 'DELETE FROM TX_QUEUE WHERE KEY=?') { transactionRows.delete(String(params[0])); return; }
    if (statement === 'UPDATE TX_QUEUE SET TRIES=?, NEXT_AT=? WHERE KEY=?') {
      const row = transactionRows.get(String(params[2]));
      if (row) { row.tries = params[0]; row.next_at = params[1]; }
      return;
    }
    throw new Error(`Unsupported SQLite run: ${statement}`);
  }),
  getAllSync: vi.fn((sql: string, params: unknown[] = []) => {
    const statement = record('getAllSync', sql, params);
    if (statement.startsWith('SELECT ') && statement.includes(' FROM HANDOVER_OFFLINE_QUEUE ORDER BY DATETIME(CREATED_AT) ASC')) {
      return [...offlineRows.values()].sort((left, right) => String(left.created_at).localeCompare(String(right.created_at))).map((row) => ({ ...row }));
    }
    if (statement.startsWith('SELECT KEY,PAYLOAD,TRIES,CREATED_AT,NEXT_AT FROM TX_QUEUE ORDER BY ')) {
      const rows = [...transactionRows.values()];
      if (statement.includes('COALESCE(NEXT_AT,0)')) rows.sort((left, right) => Number(left.next_at) - Number(right.next_at));
      return rows.map((row) => ({ ...row }));
    }
    throw new Error(`Unsupported SQLite query: ${statement}`);
  }),
  getFirstSync: vi.fn((sql: string, params: unknown[] = []) => {
    const statement = record('getFirstSync', sql, params);
    if (statement === 'SELECT COUNT(*) AS N FROM TX_QUEUE') return { n: transactionRows.size };
    if (statement.startsWith('SELECT ') && statement.includes(' FROM HANDOVER_OFFLINE_QUEUE WHERE ID=? LIMIT 1')) {
      const row = offlineRows.get(String(params[0]));
      return row ? { ...row } : undefined;
    }
    throw new Error(`Unsupported SQLite first: ${statement}`);
  }),
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
