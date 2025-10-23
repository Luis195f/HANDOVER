import { postBundleSmart } from './fhir-client';
import { ENV, FHIR_BASE_URL } from '../config/env';
import { startSyncDaemon, flushQueueNow, type SyncOpts } from './sync/index';

export async function postTransactionBundle(
  bundle: any,
  opts?: { fhirBase?: string; token?: string }
) {
  const fhirBase = opts?.fhirBase ?? ENV.FHIR_BASE_URL ?? FHIR_BASE_URL;
  return await postBundleSmart({ fhirBase, bundle, token: opts?.token });
}

export type QueueSyncOptions = {
  intervalMs?: number;
  jitterMs?: number;
  maxTries?: number;
  fhirBaseOverride?: string;
  token?: string;
};

export function installQueueSync(options: QueueSyncOptions = {}) {
  const syncOpts: SyncOpts = {
    fhirBaseUrl: options.fhirBaseOverride ?? ENV.FHIR_BASE_URL ?? FHIR_BASE_URL,
    getToken: async () => options.token ?? null,
    backoff: {
      retries: options.maxTries ?? 5,
      minMs: options.intervalMs ?? 1500,
      maxMs: (options.intervalMs ?? 1500) * 10,
    },
  };
  const stop = startSyncDaemon(syncOpts);
  return typeof stop === 'function' ? stop : undefined;
}

export async function flushNow() {
  const opts: SyncOpts = {
    fhirBaseUrl: ENV.FHIR_BASE_URL ?? FHIR_BASE_URL,
    getToken: async () => null,
  };
  await flushQueueNow(opts);
}
