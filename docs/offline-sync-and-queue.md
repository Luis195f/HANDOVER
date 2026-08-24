# Offline sync and queue

## safeFetch and retries
- `src/lib/net.ts` implements `safeFetch`: enforces HTTPS in production, applies timeouts and backoff retries for 502/503/504, and adds idempotency headers to prevent duplicates.

## Queue and synchronization
- `src/lib/queue.ts` persists bundles in SQLite alongside retry metadata.
- `handover_offline_queue` is the canonical operational queue for clinical handover bundles. `tx_queue` remains only as a legacy compatibility path and must not be treated as the UI/sync source of truth for handover runtime state.
- `src/lib/sync.ts` detects connectivity, retries with exponential backoff (`getNextDelayMs`), and removes successful items; it also uses the FHIR client to interpret `OperationOutcome` responses and treats `409/412` as already-delivered duplicates.
- Operational success evidence is strict: HANDOVER only transitions a bundle to `synced` after an explicit remote `2xx` response or an idempotent-accept contract already recognized by the repo (`409/412` in the current FHIR replay path). Local disappearance, cleanup, or malformed payloads without a clinical `bundle` are not success evidence and are retained as queue errors instead.
- Storage is encrypted by default; versioned client configuration no longer admite un flag público para desactivar el cifrado offline.
  - Each item keeps `firstEnqueuedAt`, `lastAttemptAt`, and `attemptCount`/`attempts` to compute retry windows.
  - A maximum number of attempts is enforced (`EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`, default 3). Items that exceed the limit are marked with `syncStatus="error"`.

## Runtime source of truth
- `index.ts` is the only active Expo/mobile entrypoint in this repo cut. It registers the root component from `App.tsx`.
- `App.tsx` is the active mobile bootstrap path. It mounts auth/navigation providers and installs queue replay through `src/lib/queueBootstrap.ts`.
- `src/lib/sync.ts` is the canonical sync runtime for queue state, retry scheduling, and `SyncSnapshot`.
- `src/lib/queueBootstrap.ts`, `src/screens/SyncCenter.tsx`, `src/screens/handover/useHandoverSyncStatus.ts`, `src/components/SyncStatusBanner.tsx`, and `src/components/OfflineBanner.tsx` now call `src/lib/sync.ts` directly for replay/runtime state.
- `src/lib/sync/index.ts` remains only as a thin compatibility shim over `src/lib/sync.ts`; it no longer owns replay state or drains a separate queue path.
- `src/lib/offlineQueue.ts` is a residual compatibility adapter over the canonical queue storage in `src/lib/queue.ts`. It is not part of the active HANDOVER replay/runtime path for handover bundles.
- `main.py` is absent from the current repository state. The active Python/Django operational entrypoints are `manage.py`, `Procfile` (`gunicorn backend.wsgi ...`), `.github/workflows/django.yml` (`python manage.py migrate`, `pytest`), and `docker-compose.yml` (web export build only; Django is documented as a separate Procfile-compatible service).

## Transaction identifiers (txId)
- `ensureBundleTx` (`src/lib/sync.ts`) assigns a transaction identifier when one is missing using UUID v4 to guarantee global uniqueness.
- The transaction identifier is attached to every entry via `attachTxIdToEntry`, which adds a conditional create token (`ifNoneExist`) so retries remain idempotent.
- The txId is also reflected in `Bundle.identifier` (`system=urn:handover-pro:tx`) for traceability.

## Queue item identifiers (offline queue)
- `buildOfflineQueueId(...)` (`src/lib/queue.ts`) is the canonical identity builder for handover bundles. It hashes a stable serialization of `patientId`, `payloadType`, and the bundle payload so replay deduplicates on deterministic clinical identity instead of transient runtime state.
- `computeId(fullUrls: string[])` (`src/lib/sync.ts`) remains scoped to the residual secure-store compatibility queue and is no longer the operational identity source for handover bundle replay.
- `hashHex` (`src/lib/crypto.ts`) uses SHA-256 and returns a configurable hex prefix (default 64 chars). This makes it deterministic while keeping IDs compact.
- The operational goal is to detect duplicates and avoid enqueueing the same clinical bundle identity twice. Hash collisions are astronomically unlikely; if they ever occur the safe mitigation is to compare the original payload identity inputs before skipping an enqueue.

## Canonical queue invariants
- Local persistence for handover bundles is `handover_offline_queue` in `src/lib/queue.ts`, with encrypted payload-at-rest and plaintext metadata limited to non-PHI control fields.
- Queue status is explicit and finite: `pending`, `inFlight`, `error`, `synced`. The canonical runtime in `src/lib/sync.ts` is the only active writer of replay status transitions.
- Replay is safe by construction: canonical sends reuse the persisted payload, keep idempotency headers stable (`txId` or queue item id), and treat `409/412` as delivered evidence instead of duplicate writes.
- Auth replay is fail-closed: `401` pauses the engine and requires a fresh bearer before resuming, while `403` is preserved as a terminal auth failure on the queue item instead of degrading into generic network/server retry paths.
- Deduplication is based on stable identity (`buildOfflineQueueId`) so the same handover bundle does not fork into multiple queue rows across retry/reopen flows.

## Other identifiers and hash usage
- `hashHex` also backs other deterministic identifiers such as `fhirId` (`src/lib/crypto.ts`) and several resource ID helpers in `src/lib/fhir-map.ts`.
- `fhirId` prefixes the hash, truncates to a maximum length (default 64), and replaces invalid characters to ensure valid FHIR IDs.
- Grouping keys for queue batching use time windows rather than hashing: `computeWindowStart` rounds timestamps to `GROUP_WINDOW_MS` buckets to keep related items together.

## Offline queue encryption
- FHIR bundles stored in the SQLite queue are encrypted by default using symmetric AEAD (AES-256-GCM via `@noble/ciphers` + `expo-crypto`).
- New clinical queue writes are AEAD-only: an AES-GCM failure goes directly to the observable hash-only sentinel path and never falls back to CBC.
- Only the clinical payload (FHIR bundle) is encrypted; queue metadata (status, timestamps, response code) stays in plaintext for debugging and control flow.
- Storage format for new envelopes (`EncryptedEnvelopeV1`, handled in `src/lib/crypto.ts`):

  ```json
  {
    "v": 1,
    "algo": "AES-256-GCM",
    "iv": "<base64>",
    "tag": "<base64>",
    "ct": "<base64>"
  }
  ```

- Backward compatibility:
  - Legacy plain JSON queues are still readable.
  - Legacy `v1:` and `enc:v1:` CBC payloads remain readable, but these formats are not authorized for new clinical queue writes.
  - New AES-GCM envelopes (`EncryptedEnvelopeV1`) are handled in `src/lib/crypto.ts`.
  - In all cases, `queue.ts` and `sync.ts` operate on plaintext JSON after loading.
- Security notes:
  - Offline encryption protects data at rest (aligned with GDPR/HIPAA best practices, without implying compliance).
  - Non-auth 4xx responses are marked as final queue errors; 5xx/network failures keep retry/backoff semantics.
  - SecureStore fallbacks for sensitive queue material are explicitly limited to dev/test paths; production refuses insecure fallback instead of silently using weaker storage.
  - The offline AES-GCM key is generated at runtime and persisted in secure storage; the client no longer accepts an operational encryption secret via public env.
## WebCrypto and polyfills
- The client uses `expo-crypto` for hashing and random bytes; no global `crypto` polyfill is added at runtime.
- FHIR bundle ECDSA signing in client remains acotado a runtime local de desarrollo/test y depende de `globalThis.crypto.subtle` cuando está disponible; no forma parte de la configuración versionada de staging/pilot.
- If WebCrypto is missing, client transport signing is skipped and the queue continues unsigned; that fallback is not a valid pilot/production path, which must rely on backend signature enforcement.

## UI
- `src/screens/SyncCenter.tsx` lets users inspect, retry, or clear the queue. Items with `syncStatus="error"` show an “Error” badge, differentiate `422 FHIR validation errors`, and allow viewing server-provided details (`expression` + `diagnostics`).

## Related environment variables
- `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`: maximum number of retries.
- `EXPO_PUBLIC_QUEUE_BACKOFF_BASE`: base value for exponential backoff.
- Offline encryption disablement is reserved for isolated test runtime and is not configurable through `EXPO_PUBLIC_*`.

## Fast validation before enqueue
- `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE` (default `false`) enables a remote `Bundle/$validate` check when online. If the server returns an `OperationOutcome` with `error` or `fatal` severity, the app shows an alert via `formatIssuesForUser(...)` and does not enqueue the bundle. Offline mode still enqueues for offline-first behavior.

## Sync status
- The sync engine exposes a `SyncSnapshot` (`status`, `pendingCount`, `lastRunAt`, `lastError`, `nextRetryAt`).
- Possible statuses:
  - `idle`: no pending work or waiting for new work.
  - `running`: processing the queue.
  - `backoff`: waiting for the next retry (e.g., after 5xx or no network).
  - `paused`: blocked by authentication. `401` pauses replay awaiting re-login/refresh; `403` pauses the engine after marking the affected item as `error` so permissions failures do not loop indefinitely.

## Compatibility aliases and migration notes
- `flushQueueNow` (legacy UI helper in `src/lib/sync/index.ts` and legacy queue alias in `src/lib/sync.ts`) is deprecated in favor of the canonical runtime entrypoints in `src/lib/sync.ts`.
- `postBundleSmart` (alias of `postBundle` in `src/lib/fhir-client.ts`) is deprecated. Prefer `postBundle`.
- These aliases remain for compatibility but will be removed in a future major release. Update imports to the canonical names when migrating.




