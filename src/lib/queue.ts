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

import * as SQLite from "expo-sqlite";
import { decryptPayload, encryptPayload, hashHex, payloadIsEncrypted } from "./crypto";
import { mark } from "./otel";

// -------------------------------
// DB bootstrap (Expo SQLite) + fallback
// -------------------------------
type SQLiteSyncDatabase = {
  execSync?: (sql: string) => void;
  runSync?: (sql: string, params?: unknown[]) => void;
  getAllSync?: (sql: string, params?: unknown[]) => unknown[];
  getFirstSync?: (sql: string, params?: unknown[]) => unknown;
};

const sqliteModule = SQLite as unknown as {
  openDatabaseSync?: (name: string) => SQLiteSyncDatabase;
  openDatabase?: (name: string) => SQLiteSyncDatabase;
};

const db: SQLiteSyncDatabase | null =
  sqliteModule.openDatabaseSync?.("handover.db") ?? sqliteModule.openDatabase?.("handover.db") ?? null;

// In-memory fallback (web/test sin SQLite)
type MemoryQueueRow = {
  id: number;
  key: string;
  payload: string;
  tries: number;
  created_at: number;
  next_at: number;
};

let memQueue: MemoryQueueRow[] = [];
let memId = 1;

type QueueRow = {
  key: string;
  payload: string;
  tries: number;
  created_at: number;
  next_at: number;
};

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

async function encryptQueuePayload(payload: unknown): Promise<string> {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (payloadIsEncrypted(serialized)) return serialized;
  try {
    return await encryptPayload(serialized);
  } catch (error) {
    console.warn("Fallo al cifrar payload offline", error);
    return serialized;
  }
}

async function decryptQueuePayload(payload: string): Promise<unknown> {
  try {
    const decrypted = await decryptPayload(payload);
    return safeParse(decrypted);
  } catch (error) {
    console.warn("Fallo al descifrar payload offline", error);
    return safeParse(payload);
  }
}

// BEGIN HANDOVER_OFFLINE
export type SyncStatus = "pending" | "inFlight" | "synced" | "error";

export interface QueueItem {
  id: string;
  createdAt: string;
  lastAttemptAt?: string;
  attempts: number;
  syncStatus: SyncStatus;
  errorMessage?: string;
  payloadType: "handover-bundle";
  payload: string;
  patientId: string;
}

type QueueItemInput =
  Omit<QueueItem, "id" | "createdAt" | "attempts" | "syncStatus" | "payloadType" | "payload"> &
    Partial<Pick<QueueItem, "id" | "createdAt" | "attempts" | "syncStatus" | "payloadType" | "errorMessage" | "lastAttemptAt">> & {
      payload: unknown;
    };

type QueueItemRow = {
  id: string;
  created_at: string;
  last_attempt_at?: string | null;
  attempts: number;
  sync_status: SyncStatus;
  error_message?: string | null;
  payload_type: string;
  payload: string;
  patient_id: string;
};

const OFFLINE_TABLE = "handover_offline_queue";
let memOfflineQueue: QueueItem[] = [];

if (db?.execSync) {
  db.execSync(`CREATE TABLE IF NOT EXISTS ${OFFLINE_TABLE} (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_attempt_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL,
    error_message TEXT,
    payload_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    patient_id TEXT NOT NULL
  );`);
}

function normalizeQueueItem(input: QueueItemInput & { payload: string }): QueueItem {
  const nowIso = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? `handover:${hashHex(`${Date.now()}-${Math.random()}`, 16)}`,
    createdAt: nowIso,
    lastAttemptAt: input.lastAttemptAt,
    attempts: input.attempts ?? 0,
    syncStatus: input.syncStatus ?? "pending",
    errorMessage: input.errorMessage,
    payloadType: input.payloadType ?? "handover-bundle",
    payload: input.payload,
    patientId: input.patientId,
  };
}

function rowToQueueItem(row: QueueItemRow): QueueItem {
  return {
    id: String(row.id),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    lastAttemptAt: row.last_attempt_at ?? undefined,
    attempts: Number.isFinite(row.attempts) ? Number(row.attempts) : 0,
    syncStatus: row.sync_status,
    errorMessage: row.error_message ?? undefined,
    payloadType: (row.payload_type as QueueItem["payloadType"]) ?? "handover-bundle",
    payload: row.payload,
    patientId: row.patient_id,
  };
}

function computeLegacyStatus(attempts: number): OfflineQueueStatus {
  return attempts >= DEFAULT_QUEUE_MAX_RETRIES ? "failed" : "pending";
}

function persistQueueItem(item: QueueItem): void {
  if (db?.runSync) {
    db.runSync(
      `INSERT OR REPLACE INTO ${OFFLINE_TABLE}(id,created_at,last_attempt_at,attempts,sync_status,error_message,payload_type,payload,patient_id) VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        item.id,
        item.createdAt,
        item.lastAttemptAt ?? null,
        item.attempts,
        item.syncStatus,
        item.errorMessage ?? null,
        item.payloadType,
        item.payload,
        item.patientId,
      ]
    );
    return;
  }

  const index = memOfflineQueue.findIndex((row) => row.id === item.id);
  if (index >= 0) {
    memOfflineQueue[index] = item;
  } else {
    memOfflineQueue.push(item);
  }
}

export async function createOfflineQueueItem(input: QueueItemInput): Promise<QueueItem> {
  const encryptedPayload = await encryptQueuePayload(input.payload);
  const item = normalizeQueueItem({ ...input, payload: encryptedPayload });
  persistQueueItem(item);
  return item;
}

export async function listOfflineQueue(): Promise<QueueItem[]> {
  if (db?.getAllSync) {
    const rows = (db.getAllSync(
      `SELECT id,created_at,last_attempt_at,attempts,sync_status,error_message,payload_type,payload,patient_id FROM ${OFFLINE_TABLE} ORDER BY datetime(created_at) ASC`
    ) ?? []) as QueueItemRow[];
    return rows.map(rowToQueueItem);
  }
  return memOfflineQueue
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getOfflineQueueItem(id: string): Promise<QueueItem | null> {
  if (db?.getFirstSync) {
    const row = db.getFirstSync(
      `SELECT id,created_at,last_attempt_at,attempts,sync_status,error_message,payload_type,payload,patient_id FROM ${OFFLINE_TABLE} WHERE id=? LIMIT 1`,
      [id]
    ) as QueueItemRow | undefined;
    return row ? rowToQueueItem(row) : null;
  }
  const found = memOfflineQueue.find((item) => item.id === id);
  return found ? { ...found } : null;
}

export async function updateOfflineQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | null> {
  const current = await getOfflineQueueItem(id);
  if (!current) return null;
  let payload = current.payload;
  if (updates.payload !== undefined) {
    payload = typeof updates.payload === "string" ? updates.payload : await encryptQueuePayload(updates.payload);
  }
  const next: QueueItem = {
    ...current,
    ...updates,
    attempts: updates.attempts ?? current.attempts,
    syncStatus: updates.syncStatus ?? current.syncStatus,
    payload,
    payloadType: "handover-bundle",
  };
  persistQueueItem(next);
  return next;
}

export async function deleteOfflineQueueItem(id: string): Promise<void> {
  if (db?.runSync) {
    db.runSync(`DELETE FROM ${OFFLINE_TABLE} WHERE id=?`, [id]);
  } else {
    memOfflineQueue = memOfflineQueue.filter((item) => item.id !== id);
  }
}

export async function clearOfflineQueue(): Promise<void> {
  if (db?.runSync) {
    db.runSync(`DELETE FROM ${OFFLINE_TABLE}`);
  }
  memOfflineQueue = [];
}

export function summarizePatientQueueState(items: QueueItem[]): SyncStatus {
  if (items.some((item) => item.syncStatus === "error")) return "error";
  if (items.some((item) => item.syncStatus === "pending" || item.syncStatus === "inFlight")) return "pending";
  return "synced";
}
// END HANDOVER_OFFLINE

// -------------------------------
// Tipos + estado
// -------------------------------
export type OfflineQueueJobType = "fhir-bundle" | "handover-bundle" | "sync-audio" | "unknown";

export type OfflineQueueStatus = "pending" | "processing" | "failed" | "done";

export interface OfflineQueueItem<TPayload = unknown> {
  id: string;
  key: string;
  type: OfflineQueueJobType;
  payload: TPayload; // { fhirBase, bundle, token? } o lo que el caller necesite
  retryCount: number; // mapea a tries
  createdAt: number;
  nextRetryAt: number; // timestamp ms para backoff
  status: OfflineQueueStatus;
  lastError?: string;
}

export interface LegacyTxQueueItem<TPayload = unknown> extends OfflineQueueItem<TPayload> {
  attempts: number;
  enqueuedAt: number;
  nextAt: number;
}

type SendFn = (item: LegacyTxQueueItem) => Promise<Response | { ok: boolean; status: number }>;
type FlushOpts = {
  onSuccess?: (item: LegacyTxQueueItem) => void | Promise<void>;
  maxRetries?: number;   // default 3
  baseDelayMs?: number;  // default 0 (tests rápidos). En prod: 1000–2000
};

const envQueueMaxAttempts = Number.parseInt(process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS || "", 10);
const DEFAULT_QUEUE_MAX_RETRIES = Number.isFinite(envQueueMaxAttempts) ? envQueueMaxAttempts : 3;
const envQueueBackoff = Number.parseInt(process.env.EXPO_PUBLIC_QUEUE_BACKOFF_BASE || "", 10);
const DEFAULT_QUEUE_BACKOFF_MS = Number.isFinite(envQueueBackoff) ? envQueueBackoff : 0;

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
type EnqueuePayload<TPayload = unknown> = {
  key?: string;
  id?: string;
  payload?: TPayload;
  bundle?: unknown;
  fhirBase?: string;
  type?: OfflineQueueJobType;
  createdAt?: number;
  nextAt?: number;
};

function _normalizeInput<TPayload>(input: EnqueuePayload<TPayload>): LegacyTxQueueItem<TPayload> {
  const now = input?.createdAt ?? Date.now();
  const key = input?.key || input?.id || `tx-${now}-${Math.random().toString(36).slice(2)}`;
  const payload =
    input?.payload ??
    (input?.bundle
      ? { bundle: input.bundle, fhirBase: input.fhirBase }
      : (input as unknown as TPayload));

  return {
    id: key,
    key,
    payload,
    type: input.type ?? "fhir-bundle",
    attempts: 0,
    retryCount: 0,
    enqueuedAt: now,
    createdAt: now,
    nextAt: input.nextAt ?? 0,
    nextRetryAt: input.nextAt ?? 0,
    status: "pending",
  };
}

// -------------------------------
// Enqueue
// -------------------------------
export async function enqueueTx<TPayload = unknown>(input: EnqueuePayload<TPayload>): Promise<LegacyTxQueueItem<TPayload>> {
  const item = _normalizeInput(input);
  const serializedPayload = await encryptQueuePayload(item.payload);

  if (db?.runSync) {
    db.runSync(
      "INSERT OR IGNORE INTO tx_queue(key,payload,tries,next_at,created_at) VALUES(?,?,?,?,?)",
      [item.key, serializedPayload, 0, 0, item.enqueuedAt]
    );
  } else {
    // fallback memoria
    if (!memQueue.some((r) => r.key === item.key)) {
      memQueue.push({
        id: memId++,
        key: item.key,
        payload: serializedPayload,
        tries: 0,
        next_at: item.nextAt ?? 0,
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

export async function clearTxQueue(): Promise<void> {
  if (db?.runSync) {
    db.runSync("DELETE FROM tx_queue");
  }
  memQueue = [];
  memId = 1;
}

export async function getQueueSnapshot(): Promise<LegacyTxQueueItem[]> {
  if (db?.getAllSync) {
    const rows = db.getAllSync(
      "SELECT key,payload,tries,created_at,next_at FROM tx_queue ORDER BY COALESCE(next_at,0) ASC, id ASC"
    ) as QueueRow[];
    return Promise.all(
      (rows ?? []).map(async (r) => {
        const attempts = Number(r.tries ?? 0);
        const status = computeLegacyStatus(attempts);
        const payload = (await decryptQueuePayload(String(r.payload ?? ""))) as unknown;
        const createdAt = Number(r.created_at ?? Date.now());
        const nextAt = Number(r.next_at ?? 0);
        return {
          id: r.key,
          key: r.key,
          payload,
          attempts,
          retryCount: attempts,
          enqueuedAt: createdAt,
          createdAt,
          nextAt,
          nextRetryAt: nextAt,
          status,
          type: "fhir-bundle",
        } satisfies LegacyTxQueueItem;
      })
    );
  }
  const snapshot = memQueue.slice().sort((a, b) => (a.next_at - b.next_at) || (a.id - b.id));
  return Promise.all(
    snapshot.map(async (r) => {
      const attempts = r.tries;
      const status = computeLegacyStatus(attempts);
      const payload = (await decryptQueuePayload(r.payload)) as unknown;
      return {
        id: r.key,
        key: r.key,
        payload,
        attempts,
        retryCount: attempts,
        enqueuedAt: r.created_at,
        createdAt: r.created_at,
        nextAt: r.next_at,
        nextRetryAt: r.next_at,
        status,
        type: "fhir-bundle",
      } satisfies LegacyTxQueueItem;
    })
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// -------------------------------
// Flush con backoff y 4xx/5xx
// -------------------------------
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function flushQueue(send: SendFn, opts: FlushOpts = {}) {
  const { onSuccess, maxRetries = DEFAULT_QUEUE_MAX_RETRIES, baseDelayMs = DEFAULT_QUEUE_BACKOFF_MS } = opts;

  if (_flushing) return;
  _flushing = true;
  try {
    // Traemos snapshot ordenado (respetando next_at)
    let items = await getQueueSnapshot();

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!_online) break;
      // Respetar backoff
      const nextAt = item.nextRetryAt ?? item.nextAt;
      if (nextAt && nextAt > Date.now()) continue;

      // Ejecutar envío
      const resp = await send(item).catch(() => ({ ok: false, status: 0 }));
      const responseLike = resp as Response & { ok?: boolean; status?: number };
      const status = typeof responseLike.status === "number" ? responseLike.status : 0;
      const ok = typeof responseLike.ok === "boolean" ? responseLike.ok : status >= 200 && status < 300;
      const normalizedStatus = status || (ok ? 200 : 0);

      if (ok) {
        _deleteByKey(item.key);
        mark?.("queue.flush.ok", { key: item.key });
        if (onSuccess) await onSuccess(item);
        continue;
      }

      // Error: ¿retryable?
      const retryable = normalizedStatus >= 500 || normalizedStatus === 0;
      if (!retryable) {
        // 4xx: soltar para no bloquear
        _deleteByKey(item.key);
        mark?.("queue.flush.drop4xx", { key: item.key, status: normalizedStatus });
        continue;
      }

      // Retry con backoff y cap de reintentos por flush
      const newAttempts = (item.attempts ?? 0) + 1;
      const delay = baseDelayMs * Math.pow(2, Math.max(0, newAttempts - 1));
      _updateRetry(item.key, newAttempts, Date.now() + delay);
      mark?.("queue.flush.retry", { key: item.key, status: normalizedStatus, attempts: newAttempts });

      if (newAttempts > maxRetries) {
        // dejamos el item en cola para futuros flush
        continue;
      }

      if (delay > 0) await wait(delay);
      // Recalcular snapshot por si cambió el orden/estado
      items = await getQueueSnapshot();
      index = -1;
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
    const unsub = NetInfo.addEventListener((state: { isConnected?: boolean; isInternetReachable?: boolean }) => {
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
export type Tx = { key: string; payload: unknown }; // legacy shape

/** Alias legacy — NO-OP sobre el normalizador actual */
export async function enqueue<TPayload = unknown>(input: Tx & { payload: TPayload }) {
  return enqueueTx<TPayload>(input);
}

type BundleMeta = {
  patientId?: string;
  unitId?: string;
  specialtyId?: string;
};

export async function enqueueBundle(bundle: unknown, meta: BundleMeta = {}) {
  const patientId = meta.patientId ?? 'unknown';
  const key = `handover:${hashHex(`${patientId}|${Date.now()}|${Math.random()}`, 32)}`;
  const payload = {
    bundle,
    meta: {
      patientId,
      unitId: meta.unitId,
      specialtyId: meta.specialtyId,
    },
    enqueuedAt: new Date().toISOString(),
  };
  return enqueueTx({ key, payload, type: "handover-bundle" });
}
