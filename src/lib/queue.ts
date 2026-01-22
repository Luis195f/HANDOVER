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
import {
  decryptOfflinePayload,
  decryptPayload as decryptQueueEncryptedPayload,
  encryptPayload,
  encryptOfflinePayload,
  hashHex,
  isEncryptionDisabled,
  payloadIsEncrypted as queuePayloadIsEncrypted,
} from "./crypto";
import { mark } from "./otel";
import { signBundleIfEnabled } from "../security/crypto";
import { stableStringify } from "./sync/ident";

// -------------------------------
// Web polyfills (SharedArrayBuffer)
// -------------------------------
// Some web runtimes (non crossOriginIsolated) do not expose SharedArrayBuffer.
// Some dependencies may reference it directly and crash with ReferenceError.
// We provide a conservative fallback symbol on web, while still preferring
// the real SharedArrayBuffer when available.
const _isWebRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

if (_isWebRuntime && typeof (globalThis as any).SharedArrayBuffer === 'undefined') {
  (globalThis as any).SharedArrayBuffer = ArrayBuffer;
}

const SAB = (globalThis as any).SharedArrayBuffer as (typeof SharedArrayBuffer | undefined);

export function allocBuffer(bytes: number): ArrayBuffer | SharedArrayBuffer {
  return SAB ? new SAB(bytes) : new ArrayBuffer(bytes);
}

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

const isWebRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

const db: SQLiteSyncDatabase | null =
  isWebRuntime
    ? null
    : sqliteModule.openDatabaseSync?.("handover.db") ??
      sqliteModule.openDatabase?.("handover.db") ??
      null;

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

function tryParsePayloadString(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function wrapQueuePayload(payload: unknown, patientId?: string): unknown {
  if (typeof payload === "string") {
    return { bundle: tryParsePayloadString(payload), patientId };
  }

  if (payload && typeof payload === "object") {
    const candidate = payload as { bundle?: unknown; txId?: unknown; patientId?: unknown };
    const normalizedPatientId = typeof candidate.patientId === "string" ? candidate.patientId : patientId;
    if ("bundle" in candidate || "txId" in candidate || "patientId" in candidate) {
      return { ...candidate, patientId: normalizedPatientId };
    }
  }

  return { bundle: payload, patientId };
}

async function encryptQueuePayload(payload: unknown, patientId?: string): Promise<string> {
  const wrapped = wrapQueuePayload(payload, patientId);
  const serialized = typeof wrapped === "string" ? wrapped : JSON.stringify(wrapped ?? null);
  if (isEncryptionDisabled()) {
    return serialized;
  }
  try {
    return await encryptOfflinePayload(serialized);
  } catch {
  }
  try {
    return await encryptPayload(serialized);
  } catch {
  }
  const payloadHash = hashHex(serialized);
  return JSON.stringify({ __encryptionFailed: true, payloadHash, v: 1 });
}

async function decryptQueuePayload<TFallback = unknown>(payload: unknown, opts: { unwrap?: boolean } = {}): Promise<TFallback | unknown> {
  if (payload === null || typeof payload === "undefined") return payload as TFallback | unknown;
  if (typeof payload !== "string") return payload as TFallback | unknown;

  const unwrapBundle = (value: unknown) => {
    if (opts.unwrap === false) return value;
    if (value && typeof value === "object" && "bundle" in (value as Record<string, unknown>)) {
      const inner = (value as Record<string, unknown>).bundle;
      return inner !== undefined ? inner : value;
    }
    return value;
  };

  const parseAndReturn = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as TFallback | unknown;
      return unwrapBundle(parsed);
    } catch {
      return raw as TFallback | unknown;
    }
  };

  try {
    if (queuePayloadIsEncrypted(payload)) {
      const decrypted = await decryptQueueEncryptedPayload(payload);
      return parseAndReturn(decrypted);
    }

    const maybeEnvelope = parseAndReturn(payload);
    if (typeof maybeEnvelope === "object" && maybeEnvelope && "v" in (maybeEnvelope as any) && "ct" in (maybeEnvelope as any)) {
      const decrypted = await decryptOfflinePayload(payload);
      return parseAndReturn(decrypted);
    }

    const decrypted = await decryptOfflinePayload(payload);
    if (decrypted !== payload) {
      return parseAndReturn(decrypted);
    }

    const parsed = parseAndReturn(payload);
    if (typeof parsed === "string" && queuePayloadIsEncrypted(parsed)) {
      try {
        const decrypted = await decryptQueueEncryptedPayload(parsed);
        return parseAndReturn(decrypted);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    const fallback = parseAndReturn(payload);
    if (typeof fallback === "string" && queuePayloadIsEncrypted(fallback)) {
      try {
        const decrypted = await decryptQueueEncryptedPayload(fallback);
        return parseAndReturn(decrypted);
      } catch {}
    }
    return fallback;
  }
}

function parseEncryptionFailureSentinel(payload: string): { payloadHash: string } | null {
  try {
    const parsed = JSON.parse(payload) as { __encryptionFailed?: unknown; payloadHash?: unknown; v?: unknown };
    if (parsed && parsed.__encryptionFailed === true && typeof parsed.payloadHash === "string") {
      return { payloadHash: parsed.payloadHash };
    }
  } catch {
    return null;
  }
  return null;
}

// BEGIN HANDOVER_OFFLINE
export type SyncStatus = "pending" | "inFlight" | "synced" | "error";

export interface QueueItem {
  id: string;
  createdAt: string;
  firstEnqueuedAt: string;
  lastAttemptAt?: string;
  attempts: number;
  attemptCount: number;
  syncStatus: SyncStatus;
  errorMessage?: string;
  errorStatus?: number;
  errorIssuesJson?: string;
  payloadType: "handover-bundle";
  payload: unknown;
  patientId: string;
}

type QueueItemInput =
  Omit<QueueItem, "id" | "createdAt" | "attempts" | "attemptCount" | "firstEnqueuedAt" | "syncStatus" | "payloadType" | "payload"> &
    Partial<Pick<QueueItem, "id" | "createdAt" | "firstEnqueuedAt" | "attempts" | "attemptCount" | "syncStatus" | "payloadType" | "errorMessage" | "lastAttemptAt">> & {
      payload: unknown;
    };

type QueueItemRow = {
  id: string;
  created_at: string;
  first_enqueued_at?: string | null;
  last_attempt_at?: string | null;
  attempts: number;
  attempt_count?: number | null;
  sync_status: SyncStatus;
  error_message?: string | null;
  error_status?: number | null;
  error_issues_json?: string | null;
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
    first_enqueued_at TEXT NOT NULL,
    last_attempt_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL,
    error_message TEXT,
    error_status INTEGER,
    error_issues_json TEXT,
    payload_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    patient_id TEXT NOT NULL
  );`);
  try { db.execSync(`ALTER TABLE ${OFFLINE_TABLE} ADD COLUMN error_status INTEGER;`); } catch {}
  try { db.execSync(`ALTER TABLE ${OFFLINE_TABLE} ADD COLUMN error_issues_json TEXT;`); } catch {}
  try { db.execSync(`ALTER TABLE ${OFFLINE_TABLE} ADD COLUMN first_enqueued_at TEXT NOT NULL DEFAULT '';`); } catch {}
  try { db.execSync(`ALTER TABLE ${OFFLINE_TABLE} ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;`); } catch {}
}

function normalizeQueueItem(input: QueueItemInput & { payload: string }): QueueItem {
  const nowIso = input.createdAt ?? new Date().toISOString();
  const firstEnqueuedAt = input.firstEnqueuedAt ?? input.createdAt ?? nowIso;
  const attempts = input.attempts ?? input.attemptCount ?? 0;
  const attemptCount = input.attemptCount ?? attempts;
  return {
    id: input.id ?? `handover:${hashHex(`${Date.now()}-${Math.random()}`, 16)}`,
    createdAt: nowIso,
    firstEnqueuedAt,
    lastAttemptAt: input.lastAttemptAt,
    attempts,
    attemptCount,
    syncStatus: input.syncStatus ?? "pending",
    errorMessage: input.errorMessage,
    errorStatus: input.errorStatus,
    errorIssuesJson: input.errorIssuesJson,
    payloadType: input.payloadType ?? "handover-bundle",
    payload: input.payload,
    patientId: input.patientId,
  };
}

function normalizeSyncStatus(row: QueueItemRow): SyncStatus {
  if (row.sync_status === "pending" || row.sync_status === "inFlight" || row.sync_status === "synced" || row.sync_status === "error") {
    return row.sync_status;
  }
  if ((row as any).status === "pending" || (row as any).status === "inFlight" || (row as any).status === "synced" || (row as any).status === "error") {
    return (row as any).status as SyncStatus;
  }
  if ((row as any).syncStatus === "pending" || (row as any).syncStatus === "inFlight" || (row as any).syncStatus === "synced" || (row as any).syncStatus === "error") {
    return (row as any).syncStatus as SyncStatus;
  }
  return "pending";
}

function rowToQueueItem(row: QueueItemRow): QueueItem {
  const syncStatus = normalizeSyncStatus(row);
  const attempts = Number.isFinite(row.attempts) ? Number(row.attempts) : 0;
  const attemptCount = Number.isFinite(row.attempt_count) ? Number(row.attempt_count) : attempts;
  return {
    id: String(row.id),
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    firstEnqueuedAt: row.first_enqueued_at ?? row.created_at ?? new Date().toISOString(),
    lastAttemptAt: row.last_attempt_at ?? undefined,
    attempts,
    attemptCount,
    syncStatus,
    errorMessage: row.error_message ?? undefined,
    errorStatus: row.error_status ?? undefined,
    errorIssuesJson: row.error_issues_json ?? undefined,
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
      `INSERT OR REPLACE INTO ${OFFLINE_TABLE}(id,created_at,first_enqueued_at,last_attempt_at,attempts,attempt_count,sync_status,error_message,error_status,error_issues_json,payload_type,payload,patient_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        item.id,
        item.createdAt,
        item.firstEnqueuedAt,
        item.lastAttemptAt ?? null,
        item.attempts,
        item.attemptCount,
        item.syncStatus,
        item.errorMessage ?? null,
        item.errorStatus ?? null,
        item.errorIssuesJson ?? null,
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

async function decryptQueueItemPayload(row: QueueItemRow): Promise<QueueItem> {
  const item = rowToQueueItem(row);
  try {
    return { ...item, payload: await decryptQueuePayload(row.payload, { unwrap: false }) };
  } catch {
    return { ...item, payload: row.payload };
  }
}

export async function createOfflineQueueItem(input: QueueItemInput): Promise<QueueItem> {
  const encryptedPayload = await encryptQueuePayload(input.payload, input.patientId);
  const encryptionFailed = parseEncryptionFailureSentinel(encryptedPayload);
  const item = normalizeQueueItem({
    ...input,
    payload: encryptedPayload,
    ...(encryptionFailed ? { syncStatus: "error", errorMessage: "offline_encryption_failed" } : {}),
  });
  persistQueueItem(item);
  return item;
}

export async function listOfflineQueue(options?: { decrypt?: boolean }): Promise<QueueItem[]> {
  const decrypt = options?.decrypt ?? true;
  if (db?.getAllSync) {
    const rows = (db.getAllSync(
      `SELECT id,created_at,first_enqueued_at,last_attempt_at,attempts,attempt_count,sync_status,error_message,error_status,error_issues_json,payload_type,payload,patient_id FROM ${OFFLINE_TABLE} ORDER BY datetime(created_at) ASC`
    ) ?? []) as QueueItemRow[];
    if (!decrypt) {
      return rows.map(rowToQueueItem);
    }
    return Promise.all(rows.map(decryptQueueItemPayload));
  }
  const rows = memOfflineQueue
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (!decrypt) {
    return rows.map((row) => ({ ...row }));
  }

  return Promise.all(rows.map(async (row) => ({ ...row, payload: await decryptQueuePayload(String(row.payload ?? ""), { unwrap: false }) })));
}

export async function getOfflineQueueItem(id: string): Promise<QueueItem | null> {
  if (db?.getFirstSync) {
    const row = db.getFirstSync(
      `SELECT id,created_at,first_enqueued_at,last_attempt_at,attempts,attempt_count,sync_status,error_message,error_status,error_issues_json,payload_type,payload,patient_id FROM ${OFFLINE_TABLE} WHERE id=? LIMIT 1`,
      [id]
    ) as QueueItemRow | undefined;
    return row ? decryptQueueItemPayload(row) : null;
  }
  const found = memOfflineQueue.find((item) => item.id === id);
  if (!found) return null;
  return { ...found, payload: await decryptQueuePayload(String(found.payload ?? ""), { unwrap: false }) };
}

export async function updateOfflineQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | null> {
  const current = await getOfflineQueueItem(id);
  if (!current) return null;
  const nextPayload = updates.payload !== undefined ? updates.payload : current.payload;
  const payload = await encryptQueuePayload(nextPayload, updates.patientId ?? current.patientId);
  const encryptionFailed = parseEncryptionFailureSentinel(payload);
  const attempts = updates.attempts ?? updates.attemptCount ?? current.attempts;
  const next: QueueItem = {
    ...current,
    ...updates,
    attempts,
    attemptCount: attempts,
    syncStatus: encryptionFailed ? "error" : updates.syncStatus ?? current.syncStatus,
    errorMessage: encryptionFailed ? "offline_encryption_failed" : updates.errorMessage ?? current.errorMessage,
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

type LegacyPayload<TPayload = unknown> = TPayload | { bundle: unknown; fhirBase?: string };

export interface OfflineQueueItem<TPayload = unknown> {
  id: string;
  key: string;
  type: OfflineQueueJobType;
  payload: LegacyPayload<TPayload>; // { fhirBase, bundle, token? } o lo que el caller necesite
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
  payload?: LegacyPayload<TPayload>;
  bundle?: unknown;
  fhirBase?: string;
  type?: OfflineQueueJobType;
  createdAt?: number;
  nextAt?: number;
};

function _normalizeInput<TPayload>(
  input: EnqueuePayload<TPayload>
): LegacyTxQueueItem<LegacyPayload<TPayload>> {
  const now = input?.createdAt ?? Date.now();
  const key = input?.key || input?.id || `tx-${now}-${Math.random().toString(36).slice(2)}`;
  const payload: LegacyPayload<TPayload> =
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
export async function enqueueTx<TPayload = unknown>(
  input: EnqueuePayload<TPayload>
): Promise<LegacyTxQueueItem<LegacyPayload<TPayload>>> {
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
    const row = db.getFirstSync("SELECT COUNT(*) as n FROM tx_queue") as { n?: unknown } | undefined;
    const value = row?.n;
    return typeof value === "number" ? value : Number(value ?? 0);
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

export async function getQueueSnapshot(): Promise<LegacyTxQueueItem<LegacyPayload<unknown>>[]> {
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
  signerId?: string;
  bundleId?: string;
};

const BUNDLE_IDENTIFIER_SYSTEM = "urn:handover-pro:bundle-id";
const BUNDLE_KEY_PREFIX = "handover:";

type BundleIdentifier = { system?: unknown; value?: unknown };

function getBundleIdentifier(bundle: unknown): { system?: string; value?: string } | null {
  if (!bundle || typeof bundle !== "object") return null;
  const identifier = (bundle as Record<string, unknown>).identifier as BundleIdentifier | undefined;
  if (!identifier || typeof identifier !== "object") return null;
  const system = typeof identifier.system === "string" ? identifier.system : undefined;
  const value = typeof identifier.value === "string" ? identifier.value : undefined;
  return system || value ? { system, value } : null;
}

function normalizeBundleId(value: string): string {
  return value.startsWith(BUNDLE_KEY_PREFIX) ? value.slice(BUNDLE_KEY_PREFIX.length) : value;
}

function bundleIdToKey(value: string): string {
  return value.startsWith(BUNDLE_KEY_PREFIX) ? value : `${BUNDLE_KEY_PREFIX}${value}`;
}

function sanitizeBundleForId(bundle: unknown): unknown {
  if (!bundle || typeof bundle !== "object") return bundle;
  const { identifier: _identifier, signature: _signature, ...rest } = bundle as Record<string, unknown>;
  return rest;
}

function deriveStableBundleId(bundle: unknown, patientId: string, overrideId?: string): string {
  const normalizedOverride = typeof overrideId === "string" ? overrideId.trim() : "";
  if (normalizedOverride) {
    return normalizeBundleId(normalizedOverride);
  }
  const existing = getBundleIdentifier(bundle);
  if (existing?.system === BUNDLE_IDENTIFIER_SYSTEM && typeof existing.value === "string" && existing.value.trim()) {
    return normalizeBundleId(existing.value);
  }
  const stablePayload = stableStringify(sanitizeBundleForId(bundle));
  return hashHex(`${patientId}|${stablePayload}`, 32);
}

function attachBundleIdentifier(bundle: unknown, bundleId: string): unknown {
  if (!bundle || typeof bundle !== "object") return bundle;
  return {
    ...(bundle as Record<string, unknown>),
    identifier: {
      system: BUNDLE_IDENTIFIER_SYSTEM,
      value: bundleIdToKey(bundleId),
    },
  };
}

export async function enqueueBundle(bundle: unknown, meta: BundleMeta = {}) {
  const patientId = meta.patientId ?? 'unknown';
  // Deterministic bundle identifier to prevent duplicate resources on retry.
  // Uses a hashed, stable serialization to avoid PHI leakage while keeping IDs consistent.
  const bundleId = deriveStableBundleId(bundle, patientId, meta.bundleId);
  const key = bundleIdToKey(bundleId);
  const bundleWithIdentifier = attachBundleIdentifier(bundle, bundleId);
  const { bundle: maybeSignedBundle } = await signBundleIfEnabled(bundleWithIdentifier as Record<string, unknown>, {
    queueId: key,
    signerId: meta.signerId,
  });
  const payload = {
    bundle: maybeSignedBundle,
    meta: {
      patientId,
      unitId: meta.unitId,
      specialtyId: meta.specialtyId,
    },
    enqueuedAt: new Date().toISOString(),
  };
  return enqueueTx({ key, payload, type: "handover-bundle" });
}

// Solo para pruebas: devuelve las filas crudas de la cola de transacciones
export async function __getRawTxQueueRows(): Promise<QueueRow[]> {
  if (db?.getAllSync) {
    const rows = db.getAllSync("SELECT key,payload,tries,created_at,next_at FROM tx_queue ORDER BY id ASC") as QueueRow[];
    return rows ?? [];
  }
  return memQueue.slice();
}

// Solo para pruebas: devuelve las filas crudas de la cola offline segura
export async function __getRawOfflineQueueRows(): Promise<QueueItemRow[]> {
  if (db?.getAllSync) {
    const rows = db.getAllSync(
      `SELECT id,created_at,first_enqueued_at,last_attempt_at,attempts,attempt_count,sync_status,error_message,error_status,error_issues_json,payload_type,payload,patient_id FROM ${OFFLINE_TABLE} ORDER BY datetime(created_at) ASC`
    ) as QueueItemRow[];
    return rows ?? [];
  }
  return memOfflineQueue.map((item) => ({
    id: item.id,
    created_at: item.createdAt,
    first_enqueued_at: item.firstEnqueuedAt,
    last_attempt_at: item.lastAttemptAt ?? null,
    attempts: item.attempts,
    attempt_count: item.attemptCount,
    sync_status: item.syncStatus,
    error_message: item.errorMessage ?? null,
    error_status: item.errorStatus ?? null,
    error_issues_json: item.errorIssuesJson ?? null,
    payload_type: item.payloadType,
    payload: String(item.payload ?? ""),
    patient_id: item.patientId,
  }));
}
