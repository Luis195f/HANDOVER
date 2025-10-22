// FILE: src/lib/queue.ts
// ==============================
/*
 * Cola transaccional (online/offline) con SQLite (Expo) + fallback in-memory (web/test).
 * - enqueueTx({ key?, id?, payload? | { bundle, fhirBase } })
 * - flushQueue(send, { onSuccess, maxRetries, baseDelayMs })
 * - setOnline(true|false), onReconnect(cb), attachNetInfo(send)
 * - getQueueLength(), getQueueSnapshot()
 *
 * Compat:
 * - Acepta también enqueueTx({ id, bundle }) (legacy)
 * - flushQueue(send) admite sender que devuelva Response o { ok, status }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as SQLite from "expo-sqlite";
import { mark } from "./otel";

// -------------------------------
// DB bootstrap (Expo SQLite) + fallback
// -------------------------------
type DB = any;
const db: DB =
  (SQLite as any).openDatabaseSync?.("handover.db") ??
  (SQLite as any).openDatabase?.("handover.db") ??
  null;

// In-memory fallback (web/test sin SQLite)
let memQueue: Array<{ id: number; key: string; payload: string; tries: number; created_at: number; next_at: number }> = [];
let memId = 1;

if (db?.execSync) {
  db.execSync(`CREATE TABLE IF NOT EXISTS tx_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    payload TEXT NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`);
  // Migración defensiva por si tu tabla ya existía sin next_at
  try { db.execSync("ALTER TABLE tx_queue ADD COLUMN next_at INTEGER NOT NULL DEFAULT 0;"); } catch {}
}

// -------------------------------
// Tipos + estado
// -------------------------------
export type QueueItem = {
  key: string;
  payload: any;     // { fhirBase, bundle, token? } o lo que el caller necesite
  attempts: number; // mapea a tries
  enqueuedAt: number;
  nextAt?: number;  // timestamp ms para backoff
};

type SendFn = (item: QueueItem) => Promise<Response | { ok: boolean; status: number }>;
type FlushOpts = {
  onSuccess?: (item: QueueItem) => void | Promise<void>;
  maxRetries?: number;   // default 3
  baseDelayMs?: number;  // default 0 (tests rápidos). En prod: 1000–2000
};

let _flushing = false;
let _online = true;
const _listeners: Array<() => void> = [];

function _notifyReconnect() {
  _listeners.forEach((l) => { try { l(); } catch {} });
}

export function onReconnect(cb: () => void) {
  _listeners.push(cb);
  return () => {
    const i = _listeners.indexOf(cb);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

export function setOnline(online: boolean) {
  _online = online;
  if (_online) _notifyReconnect();
}

// -------------------------------
/** Normaliza los inputs (compat con legacy) */
function _normalizeInput(input: any): QueueItem {
  const key = input?.key || input?.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload =
    input?.payload ??
    (input?.bundle
      ? { bundle: input.bundle, fhirBase: input.fhirBase }
      : input);
  return { key, payload, attempts: 0, enqueuedAt: Date.now(), nextAt: 0 };
}

// -------------------------------
// Enqueue
// -------------------------------
export async function enqueueTx(input: any): Promise<QueueItem> {
  const item = _normalizeInput(input);

  if (db?.runSync) {
    db.runSync(
      "INSERT OR IGNORE INTO tx_queue(key,payload,tries,next_at,created_at) VALUES(?,?,?,?,?)",
      [item.key, JSON.stringify(item.payload), 0, 0, item.enqueuedAt]
    );
  } else {
    // fallback memoria
    if (!memQueue.some((r) => r.key === item.key)) {
      memQueue.push({
        id: memId++,
        key: item.key,
        payload: JSON.stringify(item.payload),
        tries: 0,
        next_at: 0,
        created_at: item.enqueuedAt,
      });
    }
  }

  mark?.("queue.enqueue", { key: item.key });
  return item;
}

export function getQueueLength(): number {
  if (db?.getFirstSync) {
    const row = db.getFirstSync("SELECT COUNT(*) as n FROM tx_queue");
    return Number(row?.n ?? 0);
  }
  return memQueue.length;
}

export function getQueueSnapshot(): QueueItem[] {
  if (db?.getAllSync) {
    const rows = db.getAllSync(
      "SELECT key,payload,tries,created_at,next_at FROM tx_queue ORDER BY COALESCE(next_at,0) ASC, id ASC"
    ) as any[];
    return (rows ?? []).map((r) => ({
      key: r.key,
      payload: safeParse(r.payload),
      attempts: Number(r.tries ?? 0),
      enqueuedAt: Number(r.created_at ?? Date.now()),
      nextAt: Number(r.next_at ?? 0),
    }));
  }
  return memQueue
    .slice()
    .sort((a, b) => (a.next_at - b.next_at) || (a.id - b.id))
    .map((r) => ({
      key: r.key,
      payload: safeParse(r.payload),
      attempts: r.tries,
      enqueuedAt: r.created_at,
      nextAt: r.next_at,
    }));
}

const safeParse = (s: string) => {
  try { return JSON.parse(s); } catch { return s; }
};

// -------------------------------
// Flush con backoff y 4xx/5xx
// -------------------------------
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function flushQueue(send: SendFn, opts: FlushOpts = {}) {
  const { onSuccess, maxRetries = 3, baseDelayMs = 0 } = opts;

  if (_flushing) return;
  _flushing = true;
  try {
    // Traemos snapshot ordenado (respetando next_at)
    let items = getQueueSnapshot();

    for (const item of items) {
      if (!_online) break;
      // Respetar backoff
      if (item.nextAt && item.nextAt > Date.now()) continue;

      // Ejecutar envío
      const resp = await send(item).catch(() => ({ ok: false, status: 0 }));
      const ok = (resp as any).ok === true ||
                 ((resp as any).ok === undefined && (resp as any).status >= 200 && (resp as any).status < 300);
      const status = (resp as any).status ?? (ok ? 200 : 0);

      if (ok) {
        _deleteByKey(item.key);
        mark?.("queue.flush.ok", { key: item.key });
        if (onSuccess) await onSuccess(item);
        continue;
      }

      // Error: ¿retryable?
      const retryable = status >= 500 || status === 0;
      if (!retryable) {
        // 4xx: soltar para no bloquear
        _deleteByKey(item.key);
        mark?.("queue.flush.drop4xx", { key: item.key, status });
        continue;
      }

      // Retry con backoff y cap de reintentos por flush
      const newAttempts = (item.attempts ?? 0) + 1;
      const delay = baseDelayMs * Math.pow(2, Math.max(0, newAttempts - 1));
      _updateRetry(item.key, newAttempts, Date.now() + delay);
      mark?.("queue.flush.retry", { key: item.key, status, attempts: newAttempts });

      if (newAttempts > maxRetries) {
        // dejamos el item en cola para futuros flush
        continue;
      }

      if (delay > 0) await wait(delay);
      // Recalcular snapshot por si cambió el orden/estado
      items = getQueueSnapshot();
    }
  } finally {
    _flushing = false;
  }
}

// Helpers de acceso a almacenamiento (delete/update)
function _deleteByKey(key: string) {
  if (db?.runSync) {
    db.runSync("DELETE FROM tx_queue WHERE key=?", [key]);
  } else {
    memQueue = memQueue.filter((r) => r.key !== key);
  }
}
function _updateRetry(key: string, tries: number, nextAt: number) {
  if (db?.runSync) {
    db.runSync("UPDATE tx_queue SET tries=?, next_at=? WHERE key=?", [tries, nextAt, key]);
  } else {
    const r = memQueue.find((x) => x.key === key);
    if (r) { r.tries = tries; r.next_at = nextAt; }
  }
}

// -------------------------------
// NetInfo hook (flush al reconectar)
// -------------------------------
export function attachNetInfo(send: SendFn, opts: FlushOpts = {}) {
  try {
    const NetInfo = require("@react-native-community/netinfo").default;
    const unsub = NetInfo.addEventListener((state: any) => {
      const online = !!state?.isConnected && !!state?.isInternetReachable;
      setOnline(online);
      if (online) flushQueue(send, opts);
    });
    return () => unsub && unsub();
  } catch {
    return () => {};
  }
}

// -------------------------------
// Aliases de compatibilidad (legacy)
// -------------------------------
export type Tx = { key: string; payload: any }; // legacy shape

/** Alias legacy — NO-OP sobre el normalizador actual */
export async function enqueue(input: Tx) {
  return enqueueTx(input);
}
