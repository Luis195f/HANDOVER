// FILE: src/lib/sync/index.ts
// ---------------------------------------------------------------------
// Legacy sync compatibility shim.
//
// Canonical source of truth:
//   - src/lib/queue.ts persists the secure offline queue for handover bundles.
//   - src/lib/sync.ts owns replay, retry scheduling, sync snapshot state,
//     and recent-sync evidence.
//
// Guardrail:
//   - Do not add new runtime logic here.
//   - Keep this module as a thin adapter for legacy imports only.
// ---------------------------------------------------------------------

import NetInfo from '@/src/lib/netinfo';
import { enqueueBundle } from '../queue';
import {
  consumeRecentlySyncedQueueItem,
  flushSyncQueue,
  getCanonicalQueueSize,
  startSyncDaemon as startCanonicalSyncDaemon,
  type FlushOutcome,
  type FlushResult,
  type SyncOpts,
} from '../sync';
import {
  validateBundle as validateFHIRBundle,
  validateResourceWithZod,
  type ValidationResult,
} from '../fhir-validation/zod';
import { bundleIdempotencyKey } from './ident';

type ValidationErrorDetail = ValidationResult['errors'][number];

function enforceBundleValidation(bundle: unknown, context: string): ValidationErrorDetail[] {
  const result = validateFHIRBundle(bundle);
  if (!result.isValid) {
    const error = new Error(`FHIR bundle validation failed (${context}): ${JSON.stringify(result.errors)}`);
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = result.errors;
    if (bundle && typeof bundle === 'object') {
      (bundle as Record<string, unknown>)._validationErrors = result.errors;
    }
    throw error;
  }

  const fhirValidation = validateResourceWithZod(bundle);
  if (!fhirValidation.isValid) {
    const mappedErrors = fhirValidation.errors;
    const error = new Error(
      `FHIR structure validation failed (${context}): ${mappedErrors.map((err) => err.message).join('; ')}`,
    );
    (error as Error & { validationErrors: ValidationResult['errors'] }).validationErrors = mappedErrors;
    if (bundle && typeof bundle === 'object') {
      (bundle as Record<string, unknown>)._validationErrors = mappedErrors;
    }
    throw error;
  }

  if (bundle && typeof bundle === 'object' && '_validationErrors' in bundle) {
    delete (bundle as Record<string, unknown>)._validationErrors;
  }
  return [];
}

async function hasInternet(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!(state.isConnected && (state.isInternetReachable ?? true));
}

function extractPatientIdFromBundle(bundle: unknown): string | undefined {
  if (!bundle || typeof bundle !== 'object') return undefined;
  const entries = Array.isArray((bundle as { entry?: unknown[] }).entry)
    ? ((bundle as { entry?: unknown[] }).entry as Array<Record<string, unknown>>)
    : [];

  for (const entry of entries) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object' || (resource as { resourceType?: unknown }).resourceType !== 'Patient') {
      continue;
    }

    const identifiers = Array.isArray((resource as { identifier?: unknown[] }).identifier)
      ? ((resource as { identifier?: unknown[] }).identifier as Array<Record<string, unknown>>)
      : [];

    for (const identifier of identifiers) {
      if (
        identifier?.system === 'urn:handover-pro:ids' &&
        typeof identifier.value === 'string' &&
        identifier.value.length > 0
      ) {
        return identifier.value;
      }
    }

    if (typeof (resource as { id?: unknown }).id === 'string' && (resource as { id: string }).id.length > 0) {
      return (resource as { id: string }).id;
    }
  }

  return undefined;
}

export type { SyncOpts, FlushOutcome, FlushResult };
export { consumeRecentlySyncedQueueItem };

export function startSyncDaemon(opts: SyncOpts) {
  return startCanonicalSyncDaemon(opts);
}

export async function flushQueue(opts: SyncOpts): Promise<FlushResult> {
  return flushSyncQueue(opts);
}

export async function flushQueueNow(opts: SyncOpts): Promise<FlushResult> {
  return flushQueue(opts);
}

export async function getQueueSize(): Promise<number> {
  return getCanonicalQueueSize();
}

export async function syncBundleOrEnqueue(
  bundle: unknown,
  opts: SyncOpts,
): Promise<'sent' | 'queued'> {
  enforceBundleValidation(bundle, 'syncBundleOrEnqueue');
  const queued = await enqueueBundle(bundle, {
    patientId: extractPatientIdFromBundle(bundle) ?? 'unknown',
    bundleId: bundleIdempotencyKey(bundle),
  });

  if (!(await hasInternet())) {
    return 'queued';
  }

  const result = await flushSyncQueue(opts);
  if (result.processed > 0 && consumeRecentlySyncedQueueItem(queued.id)) {
    return 'sent';
  }
  return 'queued';
}
