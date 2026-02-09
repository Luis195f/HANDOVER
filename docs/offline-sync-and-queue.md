# Offline sync and queue

## safeFetch and retries
- `src/lib/net.ts` implements `safeFetch`: enforces HTTPS in production, applies timeouts and backoff retries for 502/503/504, and adds idempotency headers to prevent duplicates.

## Queue and synchronization
- `src/lib/queue.ts` persists bundles in SQLite alongside retry metadata.
- `src/lib/sync.ts` detects connectivity, retries with exponential backoff (`getNextDelayMs`), and removes successful items; it also uses the FHIR client to interpret `OperationOutcome` responses.
- Storage can be encrypted; `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED` can disable encryption in development.
  - Each item keeps `firstEnqueuedAt`, `lastAttemptAt`, and `attemptCount`/`attempts` to compute retry windows.
  - A maximum number of attempts is enforced (`EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`, default 3). Items that exceed the limit are marked with `syncStatus="error"`.

## Transaction identifiers (txId)
- `ensureBundleTx` (`src/lib/sync.ts`) assigns a transaction identifier when one is missing using UUID v4 to guarantee global uniqueness.
- The transaction identifier is attached to every entry via `attachTxIdToEntry`, which adds a conditional create token (`ifNoneExist`) so retries remain idempotent.
- The txId is also reflected in `Bundle.identifier` (`system=urn:handover-pro:tx`) for traceability.

## Queue item identifiers (offline queue)
- `computeId(fullUrls: string[])` (`src/lib/sync.ts`) builds a deterministic ID for an offline queue item by sorting the entry `fullUrl` values, joining them, and hashing the result with `hashHex`.
- `hashHex` (`src/lib/crypto.ts`) uses SHA-256 and returns a configurable hex prefix (default 64 chars). This makes it deterministic while keeping IDs compact.
- The goal is to detect duplicates and avoid enqueueing the same resource set twice. Hash collisions are astronomically unlikely, but if they ever occur the safe mitigation is to compare the original `fullUrl` lists before skipping an enqueue.

## Other identifiers and hash usage
- `hashHex` also backs other deterministic identifiers such as `fhirId` (`src/lib/crypto.ts`) and several resource ID helpers in `src/lib/fhir-map.ts`.
- `fhirId` prefixes the hash, truncates to a maximum length (default 64), and replaces invalid characters to ensure valid FHIR IDs.
- Grouping keys for queue batching use time windows rather than hashing: `computeWindowStart` rounds timestamps to `GROUP_WINDOW_MS` buckets to keep related items together.

## Offline queue encryption
- FHIR bundles stored in the SQLite queue are encrypted by default using symmetric AEAD (AES-256-GCM via `@noble/ciphers` + `expo-crypto`).
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
  - Legacy `enc:v1` envelopes are decrypted via `security/crypto`.
  - New AES-GCM envelopes (`EncryptedEnvelopeV1`) are handled in `src/lib/crypto.ts`.
  - In all cases, `queue.ts` and `sync.ts` operate on plaintext JSON after loading.
- Security notes:
  - Offline encryption protects data at rest (aligned with GDPR/HIPAA best practices, without implying compliance).
  - The derived key from `EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY` is the true secret and must be managed securely.

## WebCrypto and polyfills
- The client uses `expo-crypto` for hashing and random bytes; no global `crypto` polyfill is added at runtime.
- FHIR bundle ECDSA signing (if `EXPO_PUBLIC_CLIENT_SIGNING_ENABLED=true`) depends on `globalThis.crypto.subtle` when available.
- If WebCrypto is missing (e.g., web/restricted environments), client signing is skipped and the queue continues without signatures, with structured logs.

## UI
- `src/screens/SyncCenter.tsx` lets users inspect, retry, or clear the queue. Items with `syncStatus="error"` show an “Error” badge, differentiate `422 FHIR validation errors`, and allow viewing server-provided details (`expression` + `diagnostics`).

## Related environment variables
- `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`: maximum number of retries.
- `EXPO_PUBLIC_QUEUE_BACKOFF_BASE`: base value for exponential backoff.
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY`: seed for deriving the 256-bit offline encryption key. Must be at least 32 characters and stored as a secret (vault/CI/CD), not in plaintext.
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED`: feature flag to disable offline encryption (local debugging only). Values `true/1/TRUE` disable it; any other value keeps encryption enabled.

## Fast validation before enqueue
- `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE` (default `false`) enables a remote `Bundle/$validate` check when online. If the server returns an `OperationOutcome` with `error` or `fatal` severity, the app shows an alert via `formatIssuesForUser(...)` and does not enqueue the bundle. Offline mode still enqueues for offline-first behavior.

## Sync status
- The sync engine exposes a `SyncSnapshot` (`status`, `pendingCount`, `lastRunAt`, `lastError`, `nextRetryAt`).
- Possible statuses:
  - `idle`: no pending work or waiting for new work.
  - `running`: processing the queue.
  - `backoff`: waiting for the next retry (e.g., after 5xx or no network).
  - `paused`: blocked by authentication (401/403) until re-login or `resumeSync()`.

## Compatibility aliases and migration notes
- `flushQueueNow` (legacy UI helper in `src/lib/sync/index.ts` and legacy queue alias in `src/lib/sync.ts`) is deprecated in favor of `flushQueue`.
- `postBundleSmart` (alias of `postBundle` in `src/lib/fhir-client.ts`) is deprecated. Prefer `postBundle`.
- These aliases remain for compatibility but will be removed in a future major release. Update imports to the canonical names when migrating.
