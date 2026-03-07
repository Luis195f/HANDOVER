# ICEA ETL read endpoint

## Source of truth and fallback

- **Primary implementation (Option A):** `GET /api/handover/{id}` reads persisted `HandoverBundleRecord` rows from HANDOVER DB.
- **Fallback (Option B, documented only):** proxy to FHIR server can be enabled later for cache-miss scenarios, but is not the current source-of-truth implementation.

## Endpoint

`GET /api/handover/{id}`

### AuthN/AuthZ requirements

- Must send Bearer token from **client credentials** flow (`gty=client-credentials` claim).
- Accepted roles: `service_etl` or `admin`.
- Required scope (any): `icea:etl:read` or `handover:etl:read`.

### Responses

- `200` with `Content-Type: application/fhir+json` and full Bundle JSON.
- `304` when `If-None-Match` matches generated ETag.
- `401/403` unauthorized or forbidden.
- `404` bundle not found.

### Curl examples

```bash
curl -i \
  -H "Authorization: Bearer ${S2S_TOKEN}" \
  -H "Accept: application/fhir+json" \
  "https://handover.example.com/api/handover/bundle-001"
```

```bash
ETAG='W/"abc123"'
curl -i \
  -H "Authorization: Bearer ${S2S_TOKEN}" \
  -H "If-None-Match: ${ETAG}" \
  "https://handover.example.com/api/handover/bundle-001"
```

## Persistence and retention

When `POST /api/fhir/transaction` succeeds, HANDOVER persists the source bundle into `HandoverBundleRecord` with:

- `bundle_id`, `patient_id`, `unit_id`, `request_id`, `bundle_json`, `created_at`.
- Idempotency by unique `request_id` (duplicates are ignored).
- Retention metadata: default `expires_at = created_at + 30 days`.
- Encryption-at-rest metadata field (`encryption_metadata`) documenting DB-managed encryption expectations.

## Privacy and secure operations

- Do not log `Authorization` values.
- Do not log raw `request.body` or `bundle_json` payloads.
- Keep tokens scoped only for ETL read operations.
- Rotate service credentials and limit unit-level access whenever possible.
