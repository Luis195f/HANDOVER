import {
  clearOfflineQueue,
  deleteOfflineQueueItem,
  enqueueOfflineQueueItem,
  getOfflineQueue,
  type QueuedBundle,
  updateOfflineQueueItem,
} from './queue';
import { SENSITIVE_FIELDS, type SensitiveFieldPath } from '../security/sensitiveFields';
import type { ValidationResult } from './fhir-validation';

export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

type ValidationErrorDetail = ValidationResult['errors'][number];

export interface OfflineQueueItem {
  id: string;
  key: string;
  type: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  failedAt?: number;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
  validationErrors?: ValidationErrorDetail[];
  dedupKey?: string;
  /** @deprecated usa `attempts` en su lugar */
  tries?: number;
}

export type OfflineQueue = OfflineQueueItem[];

export interface EnqueuePayload {
  type?: string;
  payload?: unknown;
  key?: string;
  hash?: string;
  sensitiveFields?: SensitiveFieldPath[];
  dedupKey?: string;
}

export type SendResult = Response | { ok: boolean; status: number; stop?: boolean };

export type SendFn = (tx: OfflineQueueItem) => Promise<SendResult>;

/** @deprecated kept for backwards compatibility with legacy tests/imports. */
export const OFFLINE_QUEUE_KEY = 'handover_offline_queue_v1';

type StoredPayloadEnvelope = {
  payload: unknown;
  type?: string;
  hash?: string;
  dedupKey?: string;
  sensitiveFields?: SensitiveFieldPath[];
  validationErrors?: ValidationErrorDetail[];
};

function nowMsFromIso(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasPath(payload: unknown, path: SensitiveFieldPath): boolean {
  if (payload == null || typeof payload !== 'object') return false;
  const segments = path.split('.');
  let current: unknown = payload;

  for (const segment of segments) {
    if (current == null || (typeof current !== 'object' && !Array.isArray(current))) return false;
    if (!(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }

  return current !== undefined;
}

function isValidationError(value: unknown): value is ValidationErrorDetail {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).path === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

function detectValidationErrors(payload: unknown): ValidationErrorDetail[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const direct = (payload as Record<string, unknown>)._validationErrors;
  if (Array.isArray(direct)) {
    const cleaned = direct.filter(isValidationError);
    if (cleaned.length > 0) return cleaned;
  }
  const maybeBundle = (payload as Record<string, unknown>).bundle;
  if (maybeBundle && typeof maybeBundle === 'object') {
    const nested = (maybeBundle as Record<string, unknown>)._validationErrors;
    if (Array.isArray(nested)) {
      const cleaned = nested.filter(isValidationError);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return undefined;
}

function findSensitiveFields(payload: unknown): SensitiveFieldPath[] {
  if (payload == null || typeof payload !== 'object') return [];
  return SENSITIVE_FIELDS.filter((field) => hasPath(payload, field));
}

function parseEnvelope(payload: unknown): StoredPayloadEnvelope {
  if (!payload || typeof payload !== 'object') {
    return { payload };
  }
  const input = payload as Record<string, unknown>;

  if ('payload' in input) {
    return {
      payload: input.payload,
      type: typeof input.type === 'string' ? input.type : undefined,
      hash: typeof input.hash === 'string' ? input.hash : undefined,
      dedupKey: typeof input.dedupKey === 'string' ? input.dedupKey : undefined,
      sensitiveFields: Array.isArray(input.sensitiveFields) ? (input.sensitiveFields as SensitiveFieldPath[]) : undefined,
      validationErrors: Array.isArray(input.validationErrors)
        ? (input.validationErrors as ValidationErrorDetail[]).filter(isValidationError)
        : undefined,
    };
  }

  if ('bundle' in input && input.bundle && typeof input.bundle === 'object') {
    const nested = input.bundle as Record<string, unknown>;
    if ('payload' in nested) {
      return parseEnvelope(nested);
    }
    return { payload: input };
  }

  return { payload };
}

function toOfflineItem(item: QueuedBundle): OfflineQueueItem {
  const envelope = parseEnvelope(item.payload);
  const createdAt = nowMsFromIso(item.createdAt) ?? Date.now();
  const lastAttemptAt = nowMsFromIso(item.lastAttemptAt);
  const failedAt = item.syncStatus === 'error' ? (lastAttemptAt ?? createdAt) : undefined;

  return {
    id: item.id,
    key: item.id,
    type: envelope.type ?? 'generic',
    payload: envelope.payload,
    createdAt,
    attempts: item.attemptCount ?? item.attempts ?? 0,
    tries: item.attemptCount ?? item.attempts ?? 0,
    lastAttemptAt,
    failedAt,
    hash: envelope.hash,
    sensitiveFields: envelope.sensitiveFields,
    validationErrors: envelope.validationErrors,
    dedupKey: envelope.dedupKey,
  };
}

async function fromQueue(): Promise<OfflineQueue> {
  const queue = await getOfflineQueue();
  return queue.map(toOfflineItem).sort((a, b) => a.createdAt - b.createdAt);
}

export function shouldAttemptNow(item: OfflineQueueItem, now = Date.now()): boolean {
  if (item.failedAt) return false;
  if (item.attempts >= MAX_ATTEMPTS) return false;
  if (!item.lastAttemptAt) return true;
  const delayIndex = Math.min(item.attempts, RETRY_DELAYS_MS.length - 1);
  return now - item.lastAttemptAt >= RETRY_DELAYS_MS[delayIndex];
}

function isSuccessfulResponse(res: SendResult): boolean {
  const status = 'status' in res ? res.status : (res as Response).status;
  const okFlag = 'ok' in res ? res.ok : (res as Response).ok;
  return okFlag === true || status === 200 || status === 201 || status === 412;
}

function getStatus(res: SendResult): number {
  if ('status' in res && typeof res.status === 'number') return res.status;
  if (res instanceof Response) return res.status;
  return 0;
}

function shouldStopFlush(res: SendResult): boolean {
  return 'stop' in res && res.stop === true;
}

export async function enqueueTx(input: EnqueuePayload): Promise<OfflineQueueItem> {
  const queue = await fromQueue();

  if (input.dedupKey) {
    const duplicate = queue.find(
      (entry) => entry.type === (input.type ?? 'generic') && entry.dedupKey === input.dedupKey && !entry.failedAt
    );
    if (duplicate) return duplicate;
  }

  const payload = input.payload ?? null;
  const item = await enqueueOfflineQueueItem({
    id: input.key,
    patientId: 'legacy',
    payload: {
      payload,
      type: input.type ?? 'generic',
      hash: input.hash,
      dedupKey: input.dedupKey,
      sensitiveFields: input.sensitiveFields ?? findSensitiveFields(payload),
      validationErrors: detectValidationErrors(payload),
    },
    syncStatus: 'pending',
  });

  return toOfflineItem(item);
}

export async function readQueue(): Promise<OfflineQueue> {
  return fromQueue();
}

export async function removeItem(key: string): Promise<void> {
  await deleteOfflineQueueItem(key);
}

export async function clearAll(): Promise<void> {
  await clearOfflineQueue();
}

export async function flushQueue(sender: SendFn): Promise<void> {
  const queue = await fromQueue();

  for (const item of queue) {
    if (!shouldAttemptNow(item)) continue;

    try {
      const response = await sender(item);
      if (isSuccessfulResponse(response)) {
        await deleteOfflineQueueItem(item.key);
        continue;
      }

      const status = getStatus(response);
      const attempts = item.attempts + 1;
      const nowIso = new Date().toISOString();
      const isFinalClientError = status >= 400 && status < 500;

      await updateOfflineQueueItem(item.key, {
        attemptCount: attempts,
        attempts,
        lastAttemptAt: nowIso,
        syncStatus: isFinalClientError || attempts >= MAX_ATTEMPTS ? 'error' : 'pending',
        errorStatus: status || undefined,
      });
      if (shouldStopFlush(response)) {
        break;
      }
    } catch (error: unknown) {
      const attempts = item.attempts + 1;
      await updateOfflineQueueItem(item.key, {
        attemptCount: attempts,
        attempts,
        lastAttemptAt: new Date().toISOString(),
        syncStatus: attempts >= MAX_ATTEMPTS ? 'error' : 'pending',
        errorMessage: error instanceof Error ? error.message : 'Network error',
      });
    }
  }
}
