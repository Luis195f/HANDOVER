# MDR Annex II – Technical Documentation

**Normative reference:** HANDOVER – Relevo Seguro de Enfermería, Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería (hereinafter, HANDOVER).

## Device Description and Intended Purpose

HANDOVER is a Software as a Medical Device (SaMD) supporting nursing clinical workflows for safe shift handover, continuity of care, and structured exchange of clinical summaries. The software provides a mobile client (React Native/Expo) with a Django REST backend to handle authentication, authorization, audit logging, and interoperability with FHIR R4 transaction bundles.

The device is intended to support (not replace) clinical decision-making by enabling structured handover of patient information among authorized nursing staff. It does not generate diagnostic conclusions and must be used as clinical support software.

## Software Architecture Overview

HANDOVER uses a front-end / back-end separation:

- **Frontend (React Native/Expo)** handles the user interface, offline queueing, and local encryption for bundles and drafts. Offline data is persisted via SQLite on device with encrypted payloads and secure key storage. (`src/lib/queue.ts`, `src/lib/sync.ts`, `src/lib/crypto.ts`, `src/security/secure-storage.ts`)
- **Backend (Django + Django REST Framework)** provides authenticated endpoints, Auth0 JWT validation, RBAC + scope enforcement, FHIR bundle forwarding/validation, and audit event collection. (`backend/security/auth.py`, `backend/security/permissions.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py`, `backend/api/views.py`, `backend/api/urls.py`)

Key architectural elements:

- **Auth0 JWT authentication** and claims-based access control for roles and scopes. (`backend/security/auth.py`, `backend/security/roles.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py`)
- **FHIR R4 interoperability** using transaction bundles sent through `/api/fhir/transaction`. (`backend/api/views.py`, `backend/api/urls.py`)
- **Offline-first queue** that encrypts bundles locally and retries when connectivity returns. (`src/lib/queue.ts`, `src/lib/sync.ts`, `src/lib/crypto.ts`)

## Clinical Data Flow & Interoperability (FHIR R4)

HANDOVER uses FHIR R4 transaction bundles as the primary interchange format for clinical handover data. The backend endpoint `/api/fhir/transaction` validates incoming bundles, enforces that the bundle type is `transaction`, optionally performs remote `$validate` calls, and forwards the bundle to the configured FHIR base URL. Errors are returned with clear HTTP status codes, including `422` on validation errors and `503` if the FHIR server is unreachable. (`backend/api/views.py`, `backend/api/urls.py`)

Validation and error handling are implemented as follows:

- Parsing and schema validation use `fhir.resources` with defensive imports for R4B/R5 compatibility. (`backend/api/views.py`)
- If validation fails, the backend returns `422` and emits an audit event with `status="fail"` and `errorCode` metadata. (`backend/api/views.py`, `backend/audit/service.py`)
- Remote validation via `$validate` is supported when `HANDOVER_FHIR_VALIDATION_MODE=remote`, returning `422` when `OperationOutcome` includes `error`/`fatal` issues. (`backend/api/views.py`)

## Authentication & Authorization Model

HANDOVER enforces authentication and authorization using Auth0 JWTs with scoped access control:

- **Auth0 JWT validation** uses JWKS, issuer and audience checks, and extracts claims into `request.auth`. (`backend/security/auth.py`)
- **Roles** are extracted from known claims (`roles`, `role`, `https://handover/roles`, etc.) and normalized to lowercase. (`backend/security/roles.py`, `backend/security/permissions.py`)
- **Role-based ACL** uses `HasAnyRole` and `RequireRolesPermission` with allowed roles `nurse`, `supervisor`, and `admin`. (`backend/security/permissions_roles.py`, `backend/security/permissions.py`)
- **Scopes** are derived from `permissions`, `scope`, or `scp` claims and enforced via `HasAnyScope`. (`backend/security/scope_permissions.py`)

The endpoint `/api/me/capabilities` reports the user’s role and scope-derived permissions, including `canWriteHandover`, `canViewAudit`, and `canSignHandover`. (`backend/api/views.py`, `backend/api/urls.py`)

Access control enforcement returns `403` on insufficient role/scope combinations. This is validated in unit tests. (`backend/api/tests/test_role_acl.py`)

## Audit Logging & Traceability

Audit logging is event-based and designed to avoid PHI storage:

- **Audit events** are created with metadata such as user subject, scopes, request ID, IP, user-agent, and payload hash/size. (`backend/audit/models.py`, `backend/audit/service.py`, `backend/audit/utils.py`)
- **Payload hashing** uses HMAC-SHA256 with `AUDIT_HASH_SECRET`, ensuring traceability without storing payload contents. (`backend/audit/utils.py`, `backend/audit/service.py`, `backend/settings.py`)
- **Request correlation** is enforced via middleware that assigns `X-Request-ID`. (`backend/audit/middleware.py`)
- **Audit ingest** is a protected endpoint `/api/audit/events` using JWT auth, roles, and scopes. (`backend/audit/views.py`, `backend/api/urls.py`)

Tests explicitly validate that audit logs avoid clinical strings and that audit ingestion rejects forbidden fields, supporting the “no PHI in audit events” policy. (`backend/audit/tests/test_audit.py`)

Retention is defined by `AUDIT_RETENTION_DAYS` and enforced by the management command `prune_audit`. (`backend/settings.py`, `backend/audit/management/commands/prune_audit.py`)

## Offline Mode & Data Protection

HANDOVER supports offline-first operation with encrypted local storage:

- **Offline queue** persists transactions in SQLite (device) with in-memory fallback for web/test and includes retry/backoff logic. (`src/lib/queue.ts`, `src/lib/sync.ts`)
- **Payload encryption** uses AES-256-GCM with device-stored keys; encryption can be disabled only via explicit environment flag for controlled debugging. (`src/lib/crypto.ts`)
- **Secure key storage** uses platform secure storage when available, with AsyncStorage fallback on unsupported platforms. (`src/security/secure-storage.ts`)

Synchronization safeguards include validation before enqueue and during drain, ensuring malformed bundles are rejected and do not propagate into external FHIR servers. (`src/lib/sync.ts`)

## Risk Management Summary

The following key risks are identified and mitigated through implemented controls:

- **Access control risk (unauthorized access):** Mitigated through Auth0 JWT validation, role checks (`nurse/supervisor/admin`), and scope enforcement (`handover:write`, `handover:audit`) on protected endpoints. (`backend/security/auth.py`, `backend/security/permissions.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py`, `backend/api/views.py`)
- **Data integrity risk (corrupted/invalid bundles):** Mitigated via FHIR bundle validation and transaction type enforcement, plus optional remote `$validate`. Failures return `422` and are logged via audit events. (`backend/api/views.py`, `backend/audit/service.py`)
- **Continuity of care risk (loss of handover data in poor connectivity):** Mitigated via encrypted offline queue with retry and resynchronization logic, ensuring queued bundles are sent once connectivity is restored. (`src/lib/queue.ts`, `src/lib/sync.ts`, `src/lib/crypto.ts`)

## Verification & Validation

Verification and validation activities are automated and tied to tests and CI workflows:

- **Role/scope ACL tests** validate authorization behavior for FHIR transactions and `/api/me/capabilities`. (`backend/api/tests/test_role_acl.py`)
- **Audit logging tests** validate audit ingestion and confirm clinical strings are excluded from audit fields. (`backend/audit/tests/test_audit.py`)
- **Offline queue encryption and determinism tests** validate encryption behavior and retry logic. (`src/lib/__tests__/queue.encryption.spec.ts`, `src/lib/__tests__/sync.offline.spec.ts`, `src/lib/__tests__/sync.validation.spec.ts`)
- **Continuous Integration** runs TypeScript checks, linting, Vitest, and backend Django tests. (`.github/workflows/ci.yml`, `.github/workflows/django.yml`)

## Post-Market Surveillance (Software-focused)

Post-market surveillance is supported through:

- **Operational logging** of audit events with hash-based traceability. (`backend/audit/service.py`, `backend/audit/models.py`)
- **Incident traceability** via request IDs and audit metadata (IP/user agent) without storing PHI. (`backend/audit/middleware.py`, `backend/audit/models.py`)
- **Update and maintenance strategy** via GitHub pull requests and CI pipelines that enforce tests before release. (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.github/workflows/django.yml`)

This documentation is limited to the implemented functionality present in the repository and does not describe hypothetical modules or unimplemented features.
