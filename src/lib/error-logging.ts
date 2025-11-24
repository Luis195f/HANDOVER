import * as SQLite from 'expo-sqlite';

import NetInfo from '@/src/lib/netinfo';

export type ErrorLogRow = { id?: number; ts: number; message: string; stack?: string | null };

const TABLE = 'error_log';
const DB_NAME = 'handover.db';
const useMemoryStorage = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:8000';

const db: any =
  (!useMemoryStorage && (SQLite as any).openDatabaseSync?.(DB_NAME)) ||
  (!useMemoryStorage && (SQLite as any).openDatabase?.(DB_NAME)) ||
  null;

if (db?.execSync) {
  db.execSync(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      message TEXT NOT NULL,
      stack TEXT
    );`
  );
}

let inMemoryLogs: ErrorLogRow[] = [];
let shareErrorLogs = false;

export function setShareErrorLogsPreference(value: boolean): void {
  shareErrorLogs = value;
}

export function sanitizeText(text: string): string {
  return text
    .replace(/Patient\/[A-Za-z0-9\-]+/g, 'Patient/****')
    .replace(/fullName\s*:\s*['\"][^'\"]+['\"]/gi, "fullName:'****'")
    .replace(/user_id\s*[:=]\s*['\"]?[A-Za-z0-9\-]+['\"]?/gi, 'user_id=****');
}

function normalizeEntry(input: { message: string; stack?: string | null; ts?: number }): ErrorLogRow {
  const message = sanitizeText((input.message ?? '').slice(0, 1000));
  const stack = sanitizeText((input.stack ?? '').slice(0, 2000));
  return {
    ts: typeof input.ts === 'number' ? input.ts : Date.now(),
    message,
    stack,
  };
}

async function persistLog(row: ErrorLogRow): Promise<ErrorLogRow> {
  if (useMemoryStorage || !db) {
    const id = (inMemoryLogs.at(-1)?.id ?? 0) + 1;
    const stored = { ...row, id };
    inMemoryLogs.push(stored);
    return stored;
  }

  if (db?.runSync) {
    db.runSync(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, message TEXT, stack TEXT);`);
    db.runSync(`INSERT INTO ${TABLE}(ts, message, stack) VALUES(?,?,?)`, [row.ts, row.message, row.stack ?? null]);
    return row;
  }

  if (db?.runAsync) {
    await db.runAsync(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, message TEXT, stack TEXT);`);
    await db.runAsync(`INSERT INTO ${TABLE}(ts, message, stack) VALUES(?,?,?)`, [row.ts, row.message, row.stack ?? null]);
    return row;
  }

  const id = (inMemoryLogs.at(-1)?.id ?? 0) + 1;
  const stored = { ...row, id };
  inMemoryLogs.push(stored);
  return stored;
}

async function readPendingLogs(): Promise<ErrorLogRow[]> {
  if (useMemoryStorage || !db) {
    return [...inMemoryLogs];
  }

  if (db?.getAllSync) {
    const rows =
      (db.getAllSync(`SELECT id, ts, message, stack FROM ${TABLE} ORDER BY ts ASC`) as ErrorLogRow[]) ?? [];
    if (rows.length > 0) return rows;
  }

  if (db?.getAllAsync) {
    const rows = ((await db.getAllAsync(`SELECT id, ts, message, stack FROM ${TABLE} ORDER BY ts ASC`)) ?? []) as ErrorLogRow[];
    if (rows.length > 0) return rows;
  }

  return [...inMemoryLogs];
}

async function deleteLogs(ids: Array<number | undefined>): Promise<void> {
  const validIds = ids.filter((id): id is number => typeof id === 'number');
  if (useMemoryStorage || !db) {
    inMemoryLogs = inMemoryLogs.filter((row) => !validIds.includes(row.id ?? -1));
    return;
  }

  if (validIds.length > 0 && db?.runSync) {
    const placeholders = validIds.map(() => '?').join(',');
    db.runSync(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`, validIds);
    return;
  }

  if (validIds.length > 0 && db?.runAsync) {
    const placeholders = validIds.map(() => '?').join(',');
    await db.runAsync(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`, validIds);
    return;
  }

  inMemoryLogs = inMemoryLogs.filter((row) => !validIds.includes(row.id ?? -1));
}

async function isOnline(): Promise<boolean> {
  if (!NetInfo?.fetch) return true;
  try {
    const state = await NetInfo.fetch();
    if (state?.isInternetReachable === false) return false;
    return !!state?.isConnected;
  } catch {
    return false;
  }
}

async function sendLog(row: ErrorLogRow): Promise<boolean> {
  const payload = {
    message: row.message,
    stack: row.stack ?? '',
  };

  try {
    const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/logs/error/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function appendErrorLog(row: { message: string; stack?: string | null; ts?: number }): Promise<void> {
  const normalized = normalizeEntry(row);
  await persistLog(normalized);
}

export async function listErrorLogs(): Promise<ErrorLogRow[]> {
  return readPendingLogs();
}

export async function clearErrorLogs(): Promise<void> {
  if (useMemoryStorage || !db) {
    inMemoryLogs = [];
    return;
  }
  if (db?.runSync) {
    db.runSync(`DELETE FROM ${TABLE}`);
    return;
  }
  if (db?.runAsync) {
    await db.runAsync(`DELETE FROM ${TABLE}`);
    return;
  }
  inMemoryLogs = [];
}

export async function syncErrorLogs(): Promise<void> {
  if (!shareErrorLogs) return;
  if (!(await isOnline())) return;

  const pending = await readPendingLogs();
  if (pending.length === 0) return;

  const sentIds: Array<number | undefined> = [];
  for (const row of pending) {
    const ok = await sendLog(row);
    if (ok) {
      sentIds.push(row.id);
    }
  }

  if (sentIds.length > 0) {
    await deleteLogs(sentIds);
  }
}

export async function reportError(error: unknown, meta: { isFatal?: boolean } = {}): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = meta.isFatal ? `[FATAL] ${err.message}` : err.message;
  const stack = err.stack ?? '';

  await appendErrorLog({
    message,
    stack,
    ts: Date.now(),
  });

  if (shareErrorLogs) {
    await syncErrorLogs();
  }
}

export function installErrorLogSync(): () => void {
  if (!NetInfo?.addEventListener) return () => {};
  const unsubscribe = NetInfo.addEventListener(async (state: any) => {
    const connected = state?.isConnected && state?.isInternetReachable !== false;
    if (connected && shareErrorLogs) {
      await syncErrorLogs();
    }
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
