// src/lib/sync.ts
import NetInfo from './netinfo';
import { NetworkError, TimeoutError, HTTPError } from './net';
import { v4 as uuidv4 } from 'uuid';
import {
  buildHandoverBundle,
  mapObservationVitals,
  type BuildOptions,
  type HandoverInput,
  type HandoverValues,
} from './fhir-map';
import type { AdministrativeData } from '../types/administrative';
import { postBundle, type ResponseLike } from './fhir-client';
import { formatIssuesForUser, hasFatalOutcome, type OperationIssue } from './fhir-outcome';
import { hashHex } from './crypto';
import { z } from 'zod';
import { type ValidationResult } from './fhir-validation/zod';
import {
  deleteOfflineQueueItem,
  decryptQueuePayload,
  updateOfflineQueueStatus,
  listOfflineQueue,
  type QueueItem as OfflineQueueItem,
} from './queue';
import { signBundleIfEnabled } from '../security/crypto';
import { secureGetSensitiveItem, secureSetSensitiveItem } from '../security/secure-storage';
import { notifySyncStopped } from './notifications';
import { resolveSyncErrorMessage } from './sync-errors';
import {
  capIssuesJson,
  enforceBundleValidationWithMode,
  enforceLocalBundleValidation,
  enforceRemoteBundleValidationIfNeeded,
  resolveValidationMode,
  serializeIssuesForStorage,
  type ValidationErrorDetail,
  type ValidationOptions,
} from './sync/validation';
export { enforceBundleValidationWithMode } from './sync/validation';
export type { ValidationOptions } from './sync/validation';

type Bundle = { resourceType: 'Bundle'; type?: string; entry?: any[]; identifier?: any; meta?: any };
type TransactionBundle = {
  resourceType: 'Bundle';
  type: 'transaction';
  entry?: any[];
  _validationErrors?: ValidationErrorDetail[];
};
type BundleWithValidation = Bundle & { _validationErrors?: ValidationErrorDetail[] };

function extractHandoverValues(input: HandoverInput | HandoverValues): HandoverValues {
  return (input as { values?: HandoverValues }).values ?? (input as HandoverValues);
}

export type LegacyQueueItem = {
  patientId: string;
  bundle: TransactionBundle;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  values?: HandoverValues & { administrativeData?: AdministrativeData };
  authorId?: string;
  txId: string;
  lastError?: string;
};

export type SenderResult = Response | { ok: boolean; status: number };

export type SendFn = (tx: LegacyQueueItem) => Promise<SenderResult>;

export type FlushCompatOptions = {
  sender?: SendFn;
  /**
   * When provided, clears the draft for this patientId after a successful send
   * (201 Created / 200 OK) or a duplicate response (409/412 Already exists).
   */
  onSent?: (input: { patientId: string }) => Promise<void> | void;
  /**
   * Optional pause between items, in case the backend prefers to avoid bursts.
   */
  delayMs?: number;
  validation?: ValidationOptions;
};

const TX_IDENTIFIER_SYSTEM = 'urn:handover-pro:tx';
const OFFLINE_RETRY_DELAY_MS = 30_000;
const OFFLINE_ERROR_MESSAGE = 'Sin conexión a la red. Reintentaremos automáticamente al recuperar conectividad.';

type SyncLifecycleStatus = 'idle' | 'running' | 'backoff' | 'paused';

export type SyncSnapshot = {
  status: SyncLifecycleStatus;
  lastRunAt: string | null;
  pendingCount: number;
  lastError?: string | null;
  nextRetryAt?: number | null;
};

type SyncListener = (snapshot: SyncSnapshot) => void;

type SyncEngineOptions = {
  getToken: () => Promise<string>;
  validation?: ValidationOptions;
  onAuthError?: (error: Error) => void;
  isOnline?: () => Promise<boolean>;
  sender?: QueueSendHandler;
};

// BEGIN HANDOVER_OFFLINE
const OFFLINE_BACKOFF_SCHEDULE_MS = [60_000, 5 * 60_000, 15 * 60_000];
const OFFLINE_MAX_BACKOFF_MS = 60 * 60_000;
const envOfflineMaxAttempts = Number.parseInt(process.env.EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS || '', 10);
const OFFLINE_MAX_ATTEMPTS = Number.isFinite(envOfflineMaxAttempts) ? envOfflineMaxAttempts : 3;

export function getNextDelayMs(attempts = 0): number {
  const normalized = Number.isFinite(attempts) ? Math.max(0, Math.trunc(attempts)) : 0;
  if (normalized < OFFLINE_BACKOFF_SCHEDULE_MS.length) {
    return OFFLINE_BACKOFF_SCHEDULE_MS[normalized];
  }
  return OFFLINE_MAX_BACKOFF_MS;
}

type QueueFailureKind = 'auth' | 'client' | 'server' | 'network' | 'validation' | 'duplicate' | 'unknown';
type QueueSendSuccess = { ok: true; status?: number; message?: string; duplicate?: boolean };
type QueueSendFailure = {
  ok: false;
  kind: QueueFailureKind;
  status?: number;
  message?: string;
  recoverable?: boolean;
  errorIssuesJson?: string;
};
type QueueSendResult = QueueSendSuccess | QueueSendFailure;
type QueueSendHandler = (item: OfflineQueueItem) => Promise<QueueSendResult>;
type OfflineQueuePayload = {
  bundle?: Bundle;
  txId?: string;
  patientId?: string;
  ifNoneMatch?: string;
  headers?: Record<string, string>;
};

let queueSendHandler: QueueSendHandler = async () => ({
  ok: false,
  kind: 'auth',
  status: 401,
  recoverable: false,
  message: 'Sync engine not configured',
});

export function setQueueSendHandler(handler: QueueSendHandler): void {
  queueSendHandler = handler;
}

let syncOptions: SyncEngineOptions | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pausedForAuth = false;
let syncSnapshot: SyncSnapshot = {
  status: 'idle',
  lastRunAt: null,
  pendingCount: 0,
  lastError: null,
  nextRetryAt: null,
};
const syncListeners = new Set<SyncListener>();

function notifySyncListeners() {
  for (const listener of syncListeners) {
    try {
      listener(syncSnapshot);
    } catch (error) {
    }
  }
}

function updateSyncSnapshot(patch: Partial<SyncSnapshot>): SyncSnapshot {
  syncSnapshot = { ...syncSnapshot, ...patch };
  notifySyncListeners();
  return syncSnapshot;
}

export function getSyncSnapshot(): SyncSnapshot {
  return { ...syncSnapshot };
}

export function subscribeSyncStatus(listener: SyncListener): () => void {
  syncListeners.add(listener);
  listener(syncSnapshot);
  return () => {
    syncListeners.delete(listener);
  };
}

function cancelSyncTimer() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function scheduleSync(delayMs: number) {
  cancelSyncTimer();
  const nextRetryAt = Date.now() + delayMs;
  updateSyncSnapshot({ status: 'backoff', nextRetryAt });
  syncTimer = setTimeout(() => {
    void runSyncCycle();
  }, delayMs);
}

function pauseSync(message: string) {
  pausedForAuth = true;
  cancelSyncTimer();
  updateSyncSnapshot({ status: 'paused', lastError: message, nextRetryAt: null });
}

export function resumeSync() {
  pausedForAuth = false;
  cancelSyncTimer();
  updateSyncSnapshot({ status: 'idle', lastError: null, nextRetryAt: null });
  void runSyncCycle();
}

async function checkOnline(): Promise<boolean> {
  if (syncOptions?.isOnline) {
    try {
      return await syncOptions.isOnline();
    } catch {
      return true;
    }
  }
  try {
    const state = await NetInfo.fetch();
    return isOnlineState(state as any);
  } catch {
    return true;
  }
}

function isRecoverableStatus(status?: number): boolean {
  if (status == null) return true;
  if (status === 0) return true;
  return status >= 500;
}

function isDuplicateStatus(status?: number): status is 409 | 412 {
  return status === 409 || status === 412;
}

function isAuthStatus(status?: number): boolean {
  return status === 401 || status === 403;
}

function classifyQueueFailureKind(status?: number): QueueFailureKind {
  if (isDuplicateStatus(status)) return 'duplicate';
  if (isAuthStatus(status)) return 'auth';
  if (status === 422) return 'validation';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'client';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status === 0 || status == null) return 'network';
  return 'unknown';
}

function buildFailureOutcome(error: unknown): QueueSendResult {
  if (typeof error === 'object' && error && 'ok' in (error as Record<string, unknown>)) {
    const candidate = error as { ok?: boolean; status?: number; message?: string; recoverable?: boolean };
    return {
      ok: false,
      kind: classifyQueueFailureKind(candidate.status),
      status: candidate.status,
      message: candidate.message ?? (candidate.status ? `HTTP ${candidate.status}` : undefined),
      recoverable: candidate.recoverable,
    };
  }

  if (error instanceof Error) {
    return { ok: false, kind: 'network', recoverable: true, message: error.message };
  }
  return { ok: false, kind: 'unknown', message: typeof error === 'string' ? error : 'Unknown error' };
}

function normalizeQueueSendResult(result: QueueSendResult): QueueSendResult {
  if (result.ok || result.kind) {
    return result;
  }
  return {
    ...result,
    kind: classifyQueueFailureKind(result.status),
  };
}

function extractOfflinePayload(payload: unknown): OfflineQueuePayload | null {
  let candidate: unknown = payload;

  if (typeof payload === 'string') {
    try {
      candidate = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!candidate || typeof candidate !== 'object') return null;
  if ('payload' in (candidate as Record<string, unknown>)) {
    const nested = (candidate as { payload?: unknown }).payload;
    if (nested !== undefined) {
      return extractOfflinePayload(nested);
    }
  }
  const bundle = (candidate as { bundle?: unknown }).bundle;
  if (bundle && typeof bundle === 'object' && 'payload' in (bundle as Record<string, unknown>)) {
    return extractOfflinePayload(bundle);
  }
  return {
    bundle: bundle as Bundle | undefined,
    txId:
      typeof (candidate as { txId?: unknown }).txId === 'string'
        ? (candidate as { txId: string }).txId
        : undefined,
    patientId:
      typeof (candidate as { patientId?: unknown }).patientId === 'string'
        ? (candidate as { patientId: string }).patientId
        : undefined,
    ifNoneMatch:
      typeof (candidate as { ifNoneMatch?: unknown }).ifNoneMatch === 'string'
        ? (candidate as { ifNoneMatch: string }).ifNoneMatch
        : undefined,
    headers:
  typeof (candidate as { headers?: unknown }).headers === 'object' &&
  (candidate as { headers?: Record<string, unknown> }).headers != null
    ? Object.entries((candidate as { headers?: Record<string, unknown> }).headers ?? {}).reduce(
        (acc, [key, value]) => {
          if (typeof value === 'string') acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      )
    : undefined,
  };
}

async function resolveOfflineBundle(bundle: unknown): Promise<Bundle | null> {
  if (bundle == null) return null;
  if (typeof bundle !== 'string') return bundle as Bundle;

  // Reuse queue decryption logic so v1/legacy/plain formats stay symmetric.
  const decrypted = await decryptQueuePayload(bundle, { unwrap: true });
  if (decrypted == null) return null;

  if (typeof decrypted === 'string') {
    try {
      return JSON.parse(decrypted) as Bundle;
    } catch {
      return null;
    }
  }

  if (typeof decrypted === 'object') {
    return decrypted as Bundle;
  }

  return null;
}

function buildDefaultQueueSender(options: SyncEngineOptions): QueueSendHandler {
  return async (item) => {
    const parsed = extractOfflinePayload(item.payload);
    if (!parsed?.bundle) {
      return {
        ok: false,
        kind: 'validation',
        status: 422,
        recoverable: false,
        message: 'Offline payload missing clinical bundle',
      };
    }

    let token: string;
    try {
      token = await options.getToken();
    } catch (error) {
      return { ok: false, kind: 'auth', recoverable: true, message: (error as Error)?.message };
    }

    if (!token) {
      pauseSync('Autenticación requerida');
      options.onAuthError?.(new Error('unauthorized'));
      return { ok: false, kind: 'auth', status: 401, recoverable: false, message: 'Token requerido' };
    }

    try {
      // Local validation before sending (may annotate validationErrors).
      await enforceLocalBundleValidation(parsed.bundle, 'offline drain', options.validation);
      await enforceRemoteBundleValidationIfNeeded(parsed.bundle, 'offline drain (remote)', options.validation);


      const headers = {
        ...(parsed.headers ?? {}),
      } as Record<string, string>;

      if (!('Prefer' in headers) && !('prefer' in headers)) {
        headers.Prefer = 'return=representation';
      }
      if (parsed.ifNoneMatch && !('If-None-Match' in headers) && !('if-none-match' in headers)) {
        headers['If-None-Match'] = parsed.ifNoneMatch;
      }

      const response = await postBundle(parsed.bundle, {
        token,
        idempotencyKey: parsed.txId ?? item.id,
        headers,
      });

      const issues = response.issue ?? response.issues;
      const fatal = hasFatalOutcome(issues);
      const message =
        fatal?.diagnostics ??
        (response.body as { error?: string } | undefined)?.error ??
        response.message;

      if (isAuthStatus(response.status)) {
        pauseSync('Autenticación requerida');
        options.onAuthError?.(new Error('unauthorized'));
        return {
          ok: false,
          kind: 'auth',
          status: response.status,
          recoverable: false,
          message: message ?? 'Unauthorized',
        };
      }

      if (isDuplicateStatus(response.status)) {
        return {
          ok: true,
          status: response.status,
          duplicate: true,
          message: message ?? `HTTP ${response.status}`,
        };
      }

      if (response.status === 422) {
        const formatted = formatIssuesForUser(issues, { max: 5 });
        return {
          ok: false,
          kind: 'validation',
          status: response.status,
          recoverable: false,
          message: formatted.message,
          errorIssuesJson: serializeIssuesForStorage(issues),
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          kind: classifyQueueFailureKind(response.status),
          status: response.status,
          recoverable: fatal ? false : undefined,
          message: message ?? `HTTP ${response.status}`,
          errorIssuesJson: serializeIssuesForStorage(issues),
        };
      }

      return { ok: true, status: response.status };
    } catch (error) {
      if (error instanceof Error && error.message === 'unauthorized') {
        pauseSync('Autenticación requerida');
        options.onAuthError?.(error);
        return { ok: false, kind: 'auth', status: 401, recoverable: false, message: error.message };
      }

      // If the error comes from Zod/local validation, treat it as a non-recoverable 422.
      if (error && typeof error === 'object' && 'validationErrors' in (error as any)) {
        const errs = (error as Error & { validationErrors?: ValidationResult['errors'] }).validationErrors;
        const issues = errs?.map((err) => ({ diagnostics: err.message, expression: [err.path] }));
        const formatted = formatIssuesForUser(issues, { max: 5 });
        return {
          ok: false,
          kind: 'validation',
          status: 422,
          recoverable: false,
          message: formatted.message,
          errorIssuesJson: serializeIssuesForStorage(issues),
        };
      }

      const status = error instanceof HTTPError ? error.status : undefined;
      return {
        ok: false,
        kind: classifyQueueFailureKind(status),
        status,
        recoverable: true,
        message: error instanceof Error ? error.message : 'Network error',
      };
    }
  };
}

function shouldAttempt(item: OfflineQueueItem, now: number): boolean {
  if (item.syncStatus !== 'pending') return false;
  const attemptCount = item.attemptCount ?? item.attempts ?? 0;
  if (attemptCount === 0 && !item.lastAttemptAt) return true;
  const reference = item.lastAttemptAt ?? item.firstEnqueuedAt ?? item.createdAt;
  const base = Date.parse(reference);
  const baseline = Number.isFinite(base) ? base : 0;
  const nextAllowed = baseline + getNextDelayMs(attemptCount);
  return nextAllowed <= now;
}

function nextEligibleAt(item: OfflineQueueItem): number {
  const attemptCount = item.attemptCount ?? item.attempts ?? 0;
  if (attemptCount === 0 && !item.lastAttemptAt) {
    return Date.now();
  }
  const reference = item.lastAttemptAt ?? item.firstEnqueuedAt ?? item.createdAt;
  const base = Date.parse(reference);
  const baseline = Number.isFinite(base) ? base : Date.now();
  return baseline + getNextDelayMs(attemptCount);
}

export async function processQueueOnce(): Promise<void> {
  const now = Date.now();
  const items = await listOfflineQueue();
  const normalizeAttemptCount = (item: OfflineQueueItem): number => item.attemptCount ?? item.attempts ?? 0;
  const pendingOverLimit = items.filter(
    (item) => item.syncStatus === 'pending' && normalizeAttemptCount(item) >= OFFLINE_MAX_ATTEMPTS,
  );
  if (pendingOverLimit.length > 0) {
    await Promise.all(
      pendingOverLimit.map((item) =>
        updateOfflineQueueStatus(item.id, 'error', {
          errorMessage: item.errorMessage ?? 'Reintentos agotados',
          attemptCount: normalizeAttemptCount(item),
        }),
      ),
    );
  }
  const eligible = items
    .filter((item) => normalizeAttemptCount(item) < OFFLINE_MAX_ATTEMPTS && shouldAttempt(item, now))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const item of eligible) {
    const startedAt = new Date().toISOString();
    const attemptCount = normalizeAttemptCount(item) + 1;
    await updateOfflineQueueStatus(item.id, 'inFlight', {
      lastAttemptAt: startedAt,
      attemptCount,
    });

    let preparedPayload: OfflineQueuePayload;
    try {
      const extracted = extractOfflinePayload(item.payload);
      if (!extracted) {
        throw new Error('Offline payload could not be extracted');
      }
      preparedPayload = { ...extracted, patientId: extracted.patientId ?? item.patientId };
    } catch {
      await updateOfflineQueueStatus(item.id, 'error', {
        attemptCount,
        lastAttemptAt: startedAt,
        errorMessage: 'Error al analizar el payload offline',
      });
      continue;
    }

    const normalizedPayload = { ...preparedPayload };
    if (typeof preparedPayload.bundle === 'string') {
      try {
        const resolved = await resolveOfflineBundle(preparedPayload.bundle);
        if (!resolved) {
          throw new Error('Offline bundle could not be decrypted');
        }
        normalizedPayload.bundle = resolved;
      } catch {
        await updateOfflineQueueStatus(item.id, 'error', {
          attemptCount,
          lastAttemptAt: startedAt,
          errorMessage: 'Error al analizar el payload offline',
          errorStatus: 0,
        });
        continue;
      }
    }

    const itemWithPayload = { ...item, payload: normalizedPayload, attemptCount } as OfflineQueueItem;

    let result: QueueSendResult;
    try {
      result = normalizeQueueSendResult(await queueSendHandler(itemWithPayload));
    } catch (error) {
      result = buildFailureOutcome(error);
    }

    const duplicateDelivered = !result.ok && isDuplicateStatus(result.status);
    if (result.ok || duplicateDelivered) {
      await updateOfflineQueueStatus(item.id, 'synced', {
        attemptCount,
        lastAttemptAt: startedAt,
        errorMessage: undefined,
      });
      await deleteOfflineQueueItem(item.id);
      continue;
    }

    const isAuthError = result.kind === 'auth' || isAuthStatus(result.status);
    const status = result.status;
    const recoverable = result.recoverable ?? isRecoverableStatus(status);
    const cappedIssuesJson = capIssuesJson(result.errorIssuesJson);
    const isNonRetryableClientError = result.kind === 'client' || result.kind === 'validation';

    if (isNonRetryableClientError) {
      const errorMessage = resolveSyncErrorMessage(status, result.message);
      await updateOfflineQueueStatus(item.id, 'error', {
        attemptCount,
        lastAttemptAt: startedAt,
        errorMessage,
        errorStatus: status,
        errorIssuesJson: cappedIssuesJson,
      });
      updateSyncSnapshot({ lastError: errorMessage });
      if (status === 422) {
        void notifySyncStopped(status);
      }
      console.warn(
        `Offline sync: item ${item.id} failed with non-retryable ${status ? `HTTP ${status}` : result.kind}. Marked as error.`,
      );
      continue;
    }

    if (recoverable || isAuthError) {
      if (isAuthError) {
        pauseSync('Autenticación requerida');
        syncOptions?.onAuthError?.(new Error('unauthorized'));
      }
      const nextAttempts = attemptCount;
      if (nextAttempts >= OFFLINE_MAX_ATTEMPTS) {
        await updateOfflineQueueStatus(item.id, 'error', {
          attemptCount: nextAttempts,
          lastAttemptAt: startedAt,
          errorMessage: result.message ?? 'Reintentos agotados',
          errorStatus: result.status,
          errorIssuesJson: cappedIssuesJson,
        });
        continue;
      }
      await updateOfflineQueueStatus(item.id, 'pending', {
        attemptCount: nextAttempts,
        lastAttemptAt: startedAt,
        errorMessage: result.message ?? undefined,
        errorStatus: result.status,
        errorIssuesJson: cappedIssuesJson,
      });
      if (!isAuthError) {
        const delay = getNextDelayMs(nextAttempts);
        scheduleSync(delay);
      }
      continue;
    }

    await updateOfflineQueueStatus(item.id, 'error', {
      attemptCount,
      lastAttemptAt: startedAt,
      errorMessage: result.message ?? (result.status ? `HTTP ${result.status}` : undefined),
      errorStatus: result.status,
      errorIssuesJson: cappedIssuesJson,
    });
  }
}

async function runSyncCycle(): Promise<SyncSnapshot> {
  if (pausedForAuth) {
    return updateSyncSnapshot({ status: 'paused' });
  }

  const online = await checkOnline();
  const queue = await listOfflineQueue();
  updateSyncSnapshot({ pendingCount: queue.length });

  if (!online) {
    scheduleSync(OFFLINE_RETRY_DELAY_MS);
    return updateSyncSnapshot({
      status: 'backoff',
      lastError: OFFLINE_ERROR_MESSAGE,
    });
  }

  if (queue.length === 0) {
    cancelSyncTimer();
    return updateSyncSnapshot({
      status: 'idle',
      lastRunAt: new Date().toISOString(),
      lastError: null,
      nextRetryAt: null,
    });
  }

  updateSyncSnapshot({
    status: 'running',
    lastRunAt: new Date().toISOString(),
    lastError: null,
  });

  try {
    await processQueueOnce();
  } catch (error) {
    updateSyncSnapshot({ lastError: error instanceof Error ? error.message : String(error) });
  }

  const refreshed = await listOfflineQueue();
  const pending = refreshed.filter((item) => item.syncStatus === 'pending' || item.syncStatus === 'inFlight');
  const errored = refreshed.find((item) => item.syncStatus === 'error' && item.errorMessage);
  updateSyncSnapshot({
    pendingCount: pending.length,
    lastRunAt: new Date().toISOString(),
    lastError: errored?.errorMessage ?? syncSnapshot.lastError ?? null,
  });

  // Clean up entries marked as synced to avoid leaving stale data in the queue.
  const synced = refreshed.filter((item) => item.syncStatus === 'synced');
  if (synced.length > 0) {
    await Promise.all(synced.map((item) => deleteOfflineQueueItem(item.id)));
  }

  if (pausedForAuth) {
    return updateSyncSnapshot({ status: 'paused' });
  }

  if (pending.length === 0) {
    cancelSyncTimer();
    return updateSyncSnapshot({ status: 'idle', nextRetryAt: null });
  }

  const now = Date.now();
  const next = Math.max(0, Math.min(...pending.map((item) => nextEligibleAt(item))) - now);
  scheduleSync(next || 0);
  return syncSnapshot;
}

let syncConnectivityUnsubscribe: (() => void) | null = null;

function ensureSyncConnectivityListener() {
  if (syncConnectivityUnsubscribe || !NetInfo?.addEventListener) return;
  syncConnectivityUnsubscribe = NetInfo.addEventListener((state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
    if (isOnlineState(state)) {
      void runSyncCycle();
    }
  });
}

export function configureSyncEngine(options: SyncEngineOptions): void {
  syncOptions = options;
  pausedForAuth = false;
  cancelSyncTimer();
  setQueueSendHandler(options.sender ?? buildDefaultQueueSender(options));
  ensureSyncConnectivityListener();
  void runSyncCycle();
}

export async function forceSync(): Promise<SyncSnapshot> {
  return runSyncCycle();
}

export function stopSyncEngine(): void {
  cancelSyncTimer();
  syncOptions = null;
  if (syncConnectivityUnsubscribe) {
    try {
      syncConnectivityUnsubscribe();
    } catch {}
    syncConnectivityUnsubscribe = null;
  }
  updateSyncSnapshot({ status: 'idle', nextRetryAt: null });
}
// END HANDOVER_OFFLINE

let isOffline = false;
let offlineSince: number | null = null;
let connectivityUnsubscribe: (() => void) | null = null;
let pendingDrain: Promise<void> | null = null;
let lastTokenProvider: (() => Promise<string>) | null = null;

function isOnlineState(state: { isConnected?: boolean | null; isInternetReachable?: boolean | null } | null | undefined) {
  return !!(state?.isConnected && (state?.isInternetReachable ?? true));
}

function ensureConnectivityListener() {
  if (connectivityUnsubscribe || !NetInfo?.addEventListener) return;
  connectivityUnsubscribe = NetInfo.addEventListener((state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
    if (isOnlineState(state)) {
      isOffline = false;
      offlineSince = null;
      if (lastTokenProvider && !pendingDrain) {
        pendingDrain = drain(lastTokenProvider, { mode: resolveValidationMode() })
          .catch(() => {})
          .finally(() => {
            pendingDrain = null;
          });
      }
    } else {
      isOffline = true;
      if (offlineSince == null) offlineSince = Date.now();
    }
  });
}

function markOffline() {
  isOffline = true;
  if (offlineSince == null) offlineSince = Date.now();
  ensureConnectivityListener();
}

function handleNetworkFailure(error: unknown): boolean {
  if (error instanceof TimeoutError || error instanceof NetworkError) {
    markOffline();
    return true;
  }
  if (error instanceof HTTPError) {
    const status = error.status ?? error.response?.status ?? 0;
    if (status === 502 || status === 503 || status === 504) {
      markOffline();
      return true;
    }
  }
  return false;
}

function shouldPauseQueue(): boolean {
  return isOffline;
}

function scheduleOfflineRetry(item: LegacyQueueItem): LegacyQueueItem {
  const next = new Date(Date.now() + OFFLINE_RETRY_DELAY_MS).toISOString();
  return {
    ...item,
    attempts: item.attempts + 1,
    nextAttemptAt: next,
    updatedAt: new Date().toISOString(),
    lastError: OFFLINE_ERROR_MESSAGE,
  };
}

function scheduleSecureOfflineRetry(item: QueueItem): QueueItem {
  const next = Date.now() + OFFLINE_RETRY_DELAY_MS;
  return {
    ...item,
    attempts: item.attempts + 1,
    nextAt: next,
    lastError: OFFLINE_ERROR_MESSAGE,
  };
}

/**
 * Adds a conditional create token to an entry so the transaction can be retried
 * safely. The token embeds the transaction ID and entry index to make each
 * conditional create idempotent across retries.
 */
function attachTxIdToEntry(entry: any, txId: string, index: number) {
  if (!entry || typeof entry !== 'object') return entry;
  const request = entry.request && typeof entry.request === 'object' ? { ...entry.request } : undefined;
  if (!request) return entry;
  const current = typeof request.ifNoneExist === 'string' ? request.ifNoneExist : '';
  const suffix = `${txId}-${index}`;
  const token = `identifier=${encodeURIComponent(TX_IDENTIFIER_SYSTEM)}|${encodeURIComponent(suffix)}`;
  const alreadyHas = current.includes(TX_IDENTIFIER_SYSTEM);
  const nextIfNoneExist = alreadyHas ? current : current ? `${current}&${token}` : token;
  return {
    ...entry,
    request: {
      ...request,
      ifNoneExist: nextIfNoneExist,
    },
  };
}

/**
 * Ensures a transaction bundle has a transaction identifier and per-entry
 * conditional create tokens.
 *
 * - Generates a UUID v4 when no txId is provided to guarantee global uniqueness.
 * - Attaches the txId to each entry via {@link attachTxIdToEntry}, enabling
 *   idempotent conditional POSTs on retry.
 * - Mirrors the txId in the Bundle.identifier for traceability.
 */
function ensureBundleTx(
  bundle: { resourceType: 'Bundle'; entry?: any[]; identifier?: any; type?: string },
  existingTxId?: string
): { txId: string; bundle: TransactionBundle } {
  const txId = typeof existingTxId === 'string' && existingTxId.length > 0 ? existingTxId : uuidv4();
  const entries = Array.isArray(bundle.entry) ? bundle.entry.map((entry, index) => attachTxIdToEntry(entry, txId, index)) : [];
  const identifier =
    bundle.identifier && typeof bundle.identifier === 'object'
      ? { ...bundle.identifier, system: TX_IDENTIFIER_SYSTEM, value: txId }
      : { system: TX_IDENTIFIER_SYSTEM, value: txId };

  return {
    txId,
    bundle: {
      ...bundle,
      type: 'transaction',
      entry: entries,
      identifier,
      _validationErrors: (bundle as any)._validationErrors,
    } as TransactionBundle,
  };
}

async function safeSetItemAsync(key: string, value: string) {
  await secureSetSensitiveItem(key, value);
}

async function safeGetItemAsync(key: string) {
  return secureGetSensitiveItem(key);
}

const SECURE_QUEUE_KEY = 'handover.queue.v1';
const DEAD_QUEUE_KEY = 'handover.queue.dead.v1';
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const JITTER_RATIO = 0.25;
const GROUP_WINDOW_MS = 10 * 60 * 1000;

export type QueueItem = {
  id: string;
  patientId?: string;
  fullUrls: string[];
  bundle: BundleWithValidation;
  attempts: number;
  nextAt: number;
  windowStart: number;
  enqueuedAt: number;
  lastError?: string;
};

type StoredQueueItem = {
  id?: unknown;
  patientId?: unknown;
  fullUrls?: unknown;
  bundle?: unknown;
  attempts?: unknown;
  nextAt?: unknown;
  windowStart?: unknown;
  enqueuedAt?: unknown;
  lastError?: unknown;
};

type DeadQueueItem = QueueItem & {
  failedAt: number;
  status?: number;
  issue?: OperationIssue[];
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ensureBundleShape(bundle: unknown): BundleWithValidation {
  if (!isRecord(bundle) || bundle.resourceType !== 'Bundle') {
    throw new Error('Queue expects FHIR Bundle');
  }
  const entries = Array.isArray(bundle.entry)
    ? bundle.entry.filter((entry): entry is NonNullable<Bundle['entry']>[number] => !!entry)
    : [];
  return {
    ...(bundle as Bundle),
    resourceType: 'Bundle',
    entry: entries,
  };
}

function normalizeFullUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url) => url);
}

function normalizeQueueItem(value: StoredQueueItem): QueueItem {
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Queue item requires id');
  }

  const attempts = typeof value.attempts === 'number' && Number.isFinite(value.attempts) && value.attempts >= 0
    ? Math.floor(value.attempts)
    : 0;
  const nextAt = typeof value.nextAt === 'number' && Number.isFinite(value.nextAt) ? value.nextAt : Date.now();
  const windowStart = typeof value.windowStart === 'number' && Number.isFinite(value.windowStart)
    ? value.windowStart
    : computeWindowStart(nextAt);
  const enqueuedAt = typeof value.enqueuedAt === 'number' && Number.isFinite(value.enqueuedAt)
    ? value.enqueuedAt
    : Date.now();

  return {
    id: value.id,
    patientId: typeof value.patientId === 'string' && value.patientId.length > 0 ? value.patientId : undefined,
    fullUrls: normalizeFullUrls(value.fullUrls),
    bundle: ensureBundleShape(value.bundle),
    attempts,
    nextAt,
    windowStart,
    enqueuedAt,
    lastError: typeof value.lastError === 'string' && value.lastError.length > 0 ? value.lastError : undefined,
  };
}

async function readSecureQueue(): Promise<QueueItem[]> {
  const raw = await safeGetItemAsync(SECURE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredQueueItem => isRecord(item) && typeof item.id === 'string')
      .map((item) => normalizeQueueItem(item));
  } catch {
    return [];
  }
}

async function writeSecureQueue(items: QueueItem[]): Promise<void> {
  const payload = items.map((item) => ({ ...item }));
  await safeSetItemAsync(SECURE_QUEUE_KEY, JSON.stringify(payload));
}

async function pushDeadEntry(item: QueueItem, context?: { response?: ResponseLike; error?: string }) {
  const raw = await safeGetItemAsync(DEAD_QUEUE_KEY);
  let existing: DeadQueueItem[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        existing = parsed
          .filter((value): value is DeadQueueItem => isRecord(value) && typeof value.failedAt === 'number')
          .map((value) => ({
            ...normalizeQueueItem(value as StoredQueueItem),
            failedAt: typeof value.failedAt === 'number' ? value.failedAt : Date.now(),
            status: typeof value.status === 'number' ? value.status : undefined,
            issue: Array.isArray(value.issue) ? (value.issue as OperationIssue[]) : undefined,
            error: typeof value.error === 'string' ? value.error : undefined,
          }));
      }
    } catch {
      existing = [];
    }
  }

  const entry: DeadQueueItem = {
    ...item,
    failedAt: Date.now(),
    status: context?.response?.status,
    issue: context?.response?.issue,
    error: context?.error ?? context?.response?.issue?.[0]?.diagnostics,
  };

  existing.push(entry);
  if (existing.length > 50) {
    existing = existing.slice(existing.length - 50);
  }
  await safeSetItemAsync(DEAD_QUEUE_KEY, JSON.stringify(existing));
}

function jitter(ms: number): number {
  const spread = ms * JITTER_RATIO;
  const delta = (Math.random() * 2 - 1) * spread;
  return Math.max(0, Math.round(ms + delta));
}

function backoff(attempt: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  return Math.min(BACKOFF_MAX_MS, exp);
}

/**
 * Computes the start of the grouping window used to coalesce queue items
 * for the same patient.
 */
function computeWindowStart(timestamp: number): number {
  const window = Math.floor(timestamp / GROUP_WINDOW_MS) * GROUP_WINDOW_MS;
  return window;
}

/**
 * Computes a deterministic queue item ID based on the sorted fullUrl list.
 *
 * Uses {@link hashHex} (SHA-256, truncated) to detect duplicate bundles and
 * avoid enqueueing the same set of resources more than once. Collisions are
 * astronomically unlikely, but callers could guard against them by comparing
 * the fullUrl sets before skipping an enqueue.
 */
function computeId(fullUrls: string[]): string {
  if (fullUrls.length === 0) return 'empty';
  const base = fullUrls.slice().sort().join('|');
  return hashHex(base);
}

function collectFullUrls(bundle: Bundle): string[] {
  if (!Array.isArray(bundle.entry)) return [];
  return bundle.entry
    .map((entry) => (typeof entry?.fullUrl === 'string' ? entry.fullUrl : undefined))
    .filter((url): url is string => !!url);
}

function samePatientWindow(a: QueueItem, b: QueueItem): boolean {
  const keyA = a.patientId ?? a.id;
  const keyB = b.patientId ?? b.id;
  if (keyA !== keyB) return false;
  return Math.abs(a.windowStart - b.windowStart) <= GROUP_WINDOW_MS;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function enqueue(bundle: Bundle, opts?: { patientId?: string; validation?: ValidationOptions }): Promise<void> {
  const normalized = ensureBundleShape(bundle);
  await enforceBundleValidationWithMode(normalized, 'secure-queue enqueue', opts?.validation);
  const fullUrls = collectFullUrls(normalized);
  const id = computeId(fullUrls);
  const now = Date.now();
  const windowStart = computeWindowStart(now);
  const queue = await readSecureQueue();

  if (queue.some((item) => item.id === id)) {
    return;
  }

  const patientId = opts?.patientId ?? extractPatientIdFromBundle(normalized);
  if (patientId) {
    const idx = queue.findIndex(
      (item) => item.patientId === patientId && Math.abs(item.windowStart - windowStart) <= GROUP_WINDOW_MS,
    );
    if (idx >= 0) {
      queue[idx] = {
        ...queue[idx],
        id,
        bundle: normalized,
        fullUrls,
        attempts: 0,
        nextAt: Math.min(queue[idx].nextAt, now),
        windowStart,
        enqueuedAt: now,
        lastError: undefined,
      };
      await writeSecureQueue(queue);
      return;
    }
  }

  queue.push({
    id,
    patientId: patientId ?? undefined,
    fullUrls,
    bundle: normalized,
    attempts: 0,
    nextAt: now,
    windowStart,
    enqueuedAt: now,
    lastError: undefined,
  });

  await writeSecureQueue(queue);
}

let drainingSecureQueue = false;

export async function drain(
  getToken: () => Promise<string>,
  validation?: ValidationOptions
): Promise<void> {
  lastTokenProvider = getToken;
  ensureConnectivityListener();
  if (drainingSecureQueue || shouldPauseQueue()) return;
  drainingSecureQueue = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shouldPauseQueue()) break;
      let queue = await readSecureQueue();
      if (queue.length === 0) break;

      queue = queue.slice().sort((a, b) => a.nextAt - b.nextAt);
      const now = Date.now();
      const ready = queue.filter((item) => item.nextAt <= now);
      if (!ready.length) break;

      const head = ready[0];
      const cohort = ready.filter((item) => samePatientWindow(item, head));

      for (const item of cohort) {
        const freshQueue = await readSecureQueue();
        const index = freshQueue.findIndex((entry) => entry.id === item.id);
        if (index < 0) continue;
        const current = freshQueue[index];
        if (current.nextAt > Date.now()) continue;

               let response: ResponseLike | undefined;
        try {
          const token = await getToken();
          if (!token) throw new Error('OAuth token is required');

          // Local validation before sending (may throw validationErrors).
          await enforceLocalBundleValidation(current.bundle, 'secure-queue drain', validation);
          await enforceRemoteBundleValidationIfNeeded(current.bundle, 'secure-queue drain (remote)', validation);

          response = await postBundle(current.bundle, { token });
        } catch (error) {
          // Local/Zod validation errors are non-retryable. Remove and dead-letter.
          if (error && typeof error === 'object' && 'validationErrors' in (error as any)) {
            const [removed] = freshQueue.splice(index, 1);
            await writeSecureQueue(freshQueue);
            await pushDeadEntry(removed ?? current, {
              error: error instanceof Error ? error.message : String(error),
              // Use 422 to align with the rest of this module for validation errors.
              response: { ok: false, status: 422 } as any,
            });
            continue;
          }

          if (handleNetworkFailure(error)) {
            freshQueue[index] = scheduleSecureOfflineRetry(current);
            await writeSecureQueue(freshQueue);
            break;
          }

          const attempts = current.attempts + 1;
          const delay = jitter(backoff(attempts));
          freshQueue[index] = {
            ...current,
            attempts,
            nextAt: Date.now() + delay,
            lastError: error instanceof Error ? error.message : String(error),
          };
          await writeSecureQueue(freshQueue);
          continue;
        }

        if (response.ok) {
          freshQueue.splice(index, 1);
          await writeSecureQueue(freshQueue);
          continue;
        }

        if (shouldRetryStatus(response.status)) {
          const attempts = current.attempts + 1;
          const delay = jitter(backoff(attempts));
          freshQueue[index] = {
            ...current,
            attempts,
            nextAt: Date.now() + delay,
            lastError: response.issue?.[0]?.diagnostics ?? `HTTP ${response.status}`,
          };
          await writeSecureQueue(freshQueue);
          continue;
        }

        const [removed] = freshQueue.splice(index, 1);
        await writeSecureQueue(freshQueue);
        await pushDeadEntry(removed, { response });
        if (shouldPauseQueue()) break;
      }
    }
  } finally {
    drainingSecureQueue = false;
  }
}

function sleep(ms?: number) {
  return new Promise((r) => setTimeout(r, ms ?? 0));
}

const QUEUE_KEY = '@handover/tx-queue';
const PATIENT_IDENTIFIER_SYSTEM = 'urn:handover-pro:ids';
const OBS_IDENTIFIER_SYSTEM = 'urn:handover-pro:obs';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeNextAttempt(attempts: number, now = Date.now()) {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
  return new Date(now + exp + jitter).toISOString();
}

function ensureTransactionBundle(bundle: any): TransactionBundle {
  if (!bundle || typeof bundle !== 'object') {
    return { resourceType: 'Bundle', type: 'transaction', entry: [] };
  }
  const normalized: any = Array.isArray(bundle.entry)
    ? { ...bundle, resourceType: 'Bundle', type: 'transaction', entry: bundle.entry }
    : { ...bundle, resourceType: 'Bundle', type: 'transaction', entry: [] };
  normalized.resourceType = 'Bundle';
  normalized.type = 'transaction';
  if (!Array.isArray(normalized.entry)) {
    normalized.entry = [];
  }
  return normalized;
}

function migrateLegacyQueueItem(raw: any): LegacyQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;

  if ('patientId' in raw && 'bundle' in raw) {
    const patientId = typeof raw.patientId === 'string' ? raw.patientId : 'unknown';
    const attempts = asNumber(raw.attempts, 0);
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
    const nextAttemptAt =
      typeof raw.nextAttemptAt === 'string' ? raw.nextAttemptAt : new Date().toISOString();
    const normalizedBundle = ensureTransactionBundle(raw.bundle);
    const { txId, bundle } = ensureBundleTx(normalizedBundle, typeof raw.txId === 'string' ? raw.txId : undefined);
    const lastError = typeof raw.lastError === 'string' ? raw.lastError : undefined;
    return {
      patientId,
      bundle,
      attempts: attempts >= 0 ? attempts : 0,
      nextAttemptAt,
      createdAt,
      updatedAt,
      values: raw.values,
      authorId: raw.authorId,
      txId,
      lastError,
    };
  }

  if ('payload' in raw && typeof raw.payload === 'object' && raw.payload) {
    const payload = raw.payload as any;
    const patientId = typeof payload.patientId === 'string' ? payload.patientId : 'unknown';
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    const normalizedBundle = ensureTransactionBundle(payload.bundle);
    const { txId, bundle } = ensureBundleTx(normalizedBundle, typeof payload.txId === 'string' ? payload.txId : undefined);
    const lastError = typeof payload.lastError === 'string' ? payload.lastError : undefined;
    return {
      patientId,
      bundle,
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      createdAt,
      updatedAt: createdAt,
      values: payload.values,
      authorId: payload.authorId,
      txId,
      lastError,
    };
  }

  return null;
}

async function loadQueue(): Promise<LegacyQueueItem[]> {
  const s = await safeGetItemAsync(QUEUE_KEY);
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    const migrated = arr
      .map((raw) => migrateLegacyQueueItem(raw))
      .filter((it): it is LegacyQueueItem => !!it);
    return migrated;
  } catch {
    return [];
  }
}

async function saveQueue(items: LegacyQueueItem[]) {
  await safeSetItemAsync(QUEUE_KEY, JSON.stringify(items));
}

/**
 * Enqueues an already-built bundle (useful for retries outside the form flow).
 */
type EnqueueBundleInput = {
  patientId: string;
  bundle: any;
  values?: HandoverValues & { administrativeData?: AdministrativeData };
  authorId?: string;
  signerId?: string;
};
type EnqueueBundleOptions = ValidationOptions;

function isRawBundleInput(value: unknown): value is { resourceType?: string; entry?: any[] } {
  return !!value && typeof value === 'object' && (value as any).resourceType === 'Bundle';
}

function extractPatientIdFromBundle(bundle: { entry?: any[] }): string | undefined {
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Patient') continue;

    const identifiers = Array.isArray(resource?.identifier) ? resource.identifier : [];
    for (const identifier of identifiers) {
      if (
        identifier &&
        typeof identifier === 'object' &&
        identifier.system === PATIENT_IDENTIFIER_SYSTEM &&
        typeof identifier.value === 'string'
      ) {
        return identifier.value;
      }
    }

    if (typeof resource?.id === 'string' && resource.id.length > 0) {
      return resource.id;
    }

    if (typeof entry?.fullUrl === 'string' && entry.fullUrl.startsWith('urn:uuid:patient-')) {
      return entry.fullUrl.replace('urn:uuid:patient-', '');
    }
  }
  return undefined;
}

export async function enqueueBundle(
  input: EnqueueBundleInput | { resourceType: string; entry?: any[] },
  opts?: EnqueueBundleOptions
) {
  const normalized: EnqueueBundleInput = isRawBundleInput(input)
    ? {
        patientId: extractPatientIdFromBundle(input) ?? 'unknown',
        bundle: input,
      }
    : input;

  const patientId = normalized.patientId ?? 'unknown';
  const nowIso = new Date().toISOString();
  const queue = await loadQueue();
  const ensured = ensureTransactionBundle(normalized.bundle);
  await enforceBundleValidationWithMode(ensured, 'legacy enqueueBundle', opts);

  const existingIndex = queue.findIndex((it) => it.patientId === patientId);
  const existingTxId = existingIndex >= 0 ? queue[existingIndex].txId : undefined;
  const { txId, bundle } = ensureBundleTx(ensured, existingTxId);
  const { bundle: maybeSignedBundle } = await signBundleIfEnabled<TransactionBundle>(bundle as TransactionBundle, {
    queueId: txId,
    signerId: normalized.signerId ?? normalized.authorId,
  });
  const updated: LegacyQueueItem = {
    patientId,
    bundle: maybeSignedBundle,
    attempts: 0,
    nextAttemptAt: nowIso,
    createdAt: existingIndex >= 0 ? queue[existingIndex].createdAt : nowIso,
    updatedAt: nowIso,
    values: normalized.values,
    authorId: normalized.authorId,
    txId,
    lastError: undefined,
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = updated;
  } else {
    queue.push(updated);
  }

  await saveQueue(queue);
  return updated;
}

/**
 * Returns the current offline queue size.
 * Uses the actual queue sources (loadQueue) to avoid coupling to internal details.
 */
export async function getQueueSize(): Promise<number> {
  const [legacy, secure] = await Promise.all([loadQueue(), readSecureQueue()]);
  return legacy.length + secure.length;
}

/**
 * @deprecated Use {@link flushQueue}. This alias remains for legacy imports and will be removed in a future major release.
 */
export const flushQueueNow = flushQueue;

/**
 * Builds and enqueues a handover Bundle from form values.
 * Throws ZodError if construction/validation fails.
 */
export async function enqueueTxFromValues(
  values: HandoverValues,
  opts?: BuildOptions & { authorId?: string }
) {
  const patientId = values.patientId ?? 'unknown';
  const bundle = buildHandoverBundle(values as unknown as HandoverInput, {
    now: opts?.now,
    normalizeGlucoseToMgdl: opts?.normalizeGlucoseToMgdl,
    glucoseDecimals: opts?.glucoseDecimals,
    emitPanel: opts?.emitPanel,
    emitHasMember: opts?.emitHasMember,
    emitBpPanel: opts?.emitBpPanel,
    profileUrls: opts?.profileUrls,
    // Any additional BuildOptions fields can be added here.
  });

  return enqueueBundle({
    patientId,
    bundle,
    values,
    authorId: opts?.authorId,
  });
}

/**
 * Sends the legacy queue with a sender.
 * - 201/200: success → remove the item
 * - 409/412: duplicate → consider delivered and remove
 * - Others: keep the item for retry and continue
 */
export async function flushQueue(opts?: FlushCompatOptions) {
  ensureConnectivityListener();
  const baseSender: SendFn =
    opts?.sender ??
    (async (tx) => {
      const { bundle } = tx;
      return postBundle(bundle);
    });
  const sender: SendFn = async (tx) => {
    if (tx?.bundle) {
      await enforceLocalBundleValidation(tx.bundle, 'legacy flushQueue sender', opts?.validation);
      await enforceRemoteBundleValidationIfNeeded(tx.bundle, 'legacy flushQueue sender (remote)', opts?.validation);
    }
    return baseSender(tx);
  };

  const initialQueue = await loadQueue();
  if (initialQueue.length === 0) {
    return { total: 0, sent: 0, skipped: 0 };
  }

  if (shouldPauseQueue()) {
    return { total: initialQueue.length, sent: 0, skipped: initialQueue.length };
  }

  let sent = 0;
  let skipped = 0;
  let queue = initialQueue;

  const sorted = queue
    .slice()
    .sort((a, b) => new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime());

  for (const candidate of sorted) {
    if (shouldPauseQueue()) break;
    queue = await loadQueue();
    const current = queue.find((it) => it.patientId === candidate.patientId);
    if (!current) continue;

    if (new Date(current.nextAttemptAt).getTime() > Date.now()) {
      continue;
    }

    try {
      const res = await sender(current);
      const status =
        typeof (res as any)?.status === 'number'
          ? (res as any).status
          : res instanceof Response
            ? res.status
            : 0;
      const ok =
        (res as any)?.ok === true ||
        (res instanceof Response ? res.ok : status >= 200 && status < 300);

      if (ok || status === 200 || status === 201 || status === 409 || status === 412) {
        queue = queue.filter((it) => it.patientId !== current.patientId);
        await saveQueue(queue);
        sent++;
        await opts?.onSent?.({ patientId: current.patientId });
        continue;
      }

      const attempts = (current.attempts ?? 0) + 1;
      const nextAttemptAt = computeNextAttempt(attempts);
      const updated: LegacyQueueItem = {
        ...current,
        attempts,
        nextAttemptAt,
        updatedAt: new Date().toISOString(),
        lastError: `HTTP ${status}`,
      };
      queue = queue.map((it) => (it.patientId === current.patientId ? updated : it));
      await saveQueue(queue);
      skipped++;
    } catch (error) {
      if (handleNetworkFailure(error)) {
        const updated = scheduleOfflineRetry(current);
        queue = queue.map((it) => (it.patientId === current.patientId ? updated : it));
        await saveQueue(queue);
        skipped++;
        break;
      }
      const attempts = (current.attempts ?? 0) + 1;
      const nextAttemptAt = computeNextAttempt(attempts);
      const updated: LegacyQueueItem = {
        ...current,
        attempts,
        nextAttemptAt,
        updatedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      queue = queue.map((it) => (it.patientId === current.patientId ? updated : it));
      await saveQueue(queue);
      skipped++;
    }

    if (opts?.delayMs && opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  return { total: initialQueue.length, sent, skipped };
}

/**
 * Legacy flush wrapper kept for test compatibility. Prefer {@link flushQueue}.
 * Planned removal: once all test callers migrate to flushQueue.
 */
export async function flush(
  sender?: SendFn | FlushCompatOptions,
  clearDraft?: ((patientId: string) => Promise<void> | void) | { baseDelayMs?: number },
  legacyOptions?: { baseDelayMs?: number },
) {
  if (typeof sender === 'object' && sender !== null && !('length' in sender)) {
    return flushQueue(sender as FlushCompatOptions);
  }

  const actualSender = typeof sender === 'function' ? sender : undefined;

  let onSent: FlushCompatOptions['onSent'] | undefined;
  let delayMs: number | undefined;

  if (typeof clearDraft === 'function') {
    onSent = async ({ patientId }) => {
      await clearDraft(patientId);
    };
  } else if (clearDraft && typeof clearDraft === 'object') {
    delayMs = clearDraft.baseDelayMs;
  }

  if (legacyOptions && typeof legacyOptions.baseDelayMs === 'number') {
    delayMs = legacyOptions.baseDelayMs;
  }

  return flushQueue({ sender: actualSender, onSent, delayMs });
}

/**
 * Builds a transaction Bundle with binary entries + conditional creates for
 * Observations/Patient based on the queued data.
 * Useful for test suites that want to inspect the bundle shape sent to the sender.
 */
export function buildTransactionBundleForQueue(
  input: HandoverInput | HandoverValues,
  opts: BuildOptions = {},
) {
  const values = extractHandoverValues(input);
  if (!values || typeof values.patientId !== 'string' || values.patientId.length === 0) {
    throw new Error('patientId required');
  }

  const patientIdRaw = values.patientId;
  const patientId = patientIdRaw ?? 'unknown';
  if (!patientIdRaw) {
    return { resourceType: 'Bundle', type: 'transaction', entry: [] };
  }

  const rawNow = opts.now ?? new Date();
  const resolvedNow = typeof rawNow === 'function' ? rawNow() : rawNow;
  const nowIso = typeof resolvedNow === 'string' ? resolvedNow : resolvedNow.toISOString();
  const patientFullUrl = `urn:uuid:patient-${patientId}`;
  const baseDate = (typeof resolvedNow === 'string' ? resolvedNow : resolvedNow.toISOString()).slice(0, 10);

  const observationOptions: BuildOptions = {
    now: resolvedNow,
    emitIndividuals: opts.emitIndividuals,
    normalizeGlucoseToMgDl: opts.normalizeGlucoseToMgDl,
    normalizeGlucoseToMgdl: opts.normalizeGlucoseToMgdl,
    glucoseDecimals: opts.glucoseDecimals,
  };

  const rawVitals = values.vitals ?? {};
  const tempValue = Number.isFinite((rawVitals as { tempC?: number }).tempC)
    ? (rawVitals as { tempC?: number }).tempC
    : Number.isFinite((rawVitals as { temp?: number }).temp)
      ? (rawVitals as { temp?: number }).temp
      : undefined;
  const avpuValue = (() => {
    const candidate =
      (rawVitals as { avpu?: unknown }).avpu ??
      (rawVitals as { acvpu?: unknown }).acvpu;
    if (candidate === 'A' || candidate === 'C' || candidate === 'V' || candidate === 'P' || candidate === 'U') {
      return candidate;
    }
    return undefined;
  })();
  const observations = values.vitals
    ? mapObservationVitals(
        {
          patientId: values.patientId,
          encounterId: values.encounterId,
          ...rawVitals,
          tempC: tempValue,
          avpu: avpuValue,
        },
        observationOptions
      )
    : [];

  const entries: Array<{
    fullUrl: string;
    resource: any;
    request: { method: string; url: string; ifNoneExist?: string };
  }> = [];

  entries.push({
    fullUrl: patientFullUrl,
    resource: {
      resourceType: 'Patient',
      identifier: [{ system: PATIENT_IDENTIFIER_SYSTEM, value: patientId }],
    },
    request: {
      method: 'POST',
      url: 'Patient',
      ifNoneExist: `identifier=${encodeURIComponent(PATIENT_IDENTIFIER_SYSTEM)}|${encodeURIComponent(patientId)}`,
    },
  });

  observations.forEach((obs, index) => {
    const cloned = JSON.parse(JSON.stringify(obs ?? {}));
    cloned.subject = { reference: patientFullUrl };

    const loinc = Array.isArray(cloned?.code?.coding)
      ? cloned.code.coding.find((c: any) => c?.system === 'http://loinc.org')?.code
      : undefined;

    const effective = typeof cloned.effectiveDateTime === 'string' && cloned.effectiveDateTime.length
      ? cloned.effectiveDateTime
      : nowIso;
    const effectiveDate = effective.slice(0, 10) || baseDate;

    const identifierParts = [loinc, effectiveDate, patientId].filter(Boolean);
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      const existing = Array.isArray(cloned.identifier) ? cloned.identifier : [];
      cloned.identifier = [
        ...existing.filter((it: any) => it && typeof it === 'object'),
        { system: OBS_IDENTIFIER_SYSTEM, value: identifierValue },
      ];
    }

    const ifNoneParts: string[] = [];
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      ifNoneParts.push(
        `identifier=${encodeURIComponent(OBS_IDENTIFIER_SYSTEM)}|${encodeURIComponent(identifierValue)}`,
      );
    }

    ifNoneParts.push(`patient=${encodeURIComponent(patientFullUrl)}`);

    if (loinc) {
      ifNoneParts.push(`code=${encodeURIComponent('http://loinc.org')}|${encodeURIComponent(loinc)}`);
    }

    ifNoneParts.push(`effective=eq${effectiveDate}`);

    const fullUrl = `urn:uuid:obs-${loinc ?? 'custom'}-${patientId}-${effectiveDate}-${index}`;

    entries.push({
      fullUrl,
      resource: cloned,
      request: {
        method: 'POST',
        url: 'Observation',
        ifNoneExist: ifNoneParts.join('&'),
      },
    });
  });

  const baseBundle: TransactionBundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };

  return ensureBundleTx(baseBundle).bundle;
}

/** Returns the current queue state (for debugging / UI). */
export async function readQueueState() {
  const items = await loadQueue();
  return {
    size: items.length,
    items,
  };
}

/** Clears the queue entirely (debug utility). */
export async function clearQueue() {
  await saveQueue([]);
}

/**
 * Enqueues from a minimal HandoverInput, used in integration tests or when you
 * already have the values (not from the form).
 */
export async function enqueueTx(
  input: HandoverInput | HandoverValues,
  opts?: BuildOptions & { authorId?: string },
) {
  const values = extractHandoverValues(input as HandoverInput | HandoverValues);
  if (typeof values !== 'object' || values === null || !('patientId' in values) || !(values as any).patientId) {
    throw new Error('patientId required');
  }
  return enqueueTxFromValues(values, opts);
}

/**
 * Fast validation (useful in tests) to ensure the handover input contains
 * patientId or patient.id.
 */
export function validateHandoverInput(input: unknown) {
  const S = z
    .object({
      patientId: z.string().optional(),
      patient: z.object({ id: z.string().optional() }).optional(),
    })
    .strict();
  return S.parse(input);
}

export const __test__ = {
  ensureBundleTx,
};

