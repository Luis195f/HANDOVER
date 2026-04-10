import { configureFHIRClient, postBundle } from './fhir-client';
import { ENV, FHIR_BASE_URL } from '../config/env';
import { startSyncDaemon, flushSyncQueue, type SyncOpts } from './sync';
import { ensureFreshAccessToken } from '../security/auth';

// App.tsx remains the active mobile bootstrap entrypoint; wire it directly to the
// canonical sync runtime so replay does not fork through the legacy facade.
async function getLegacyBootstrapSessionToken(): Promise<string | null> {
  try {
    return (await ensureFreshAccessToken('fhir')) ?? null;
  } catch {
    return null;
  }
}

export async function postTransactionBundle(
  bundle: any,
  opts?: { fhirBase?: string; token?: string }
) {
  const fhirBase = opts?.fhirBase ?? ENV.FHIR_BASE_URL ?? FHIR_BASE_URL;
  configureFHIRClient({
    getBaseUrl: () => fhirBase,
    ensureFreshToken: async () => opts?.token ?? null,
  });
  return await postBundle(bundle, { token: opts?.token ?? undefined });
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
    getToken: getLegacyBootstrapSessionToken,
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
    getToken: getLegacyBootstrapSessionToken,
  };
  await flushSyncQueue(opts);
}
