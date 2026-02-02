# QMS – HANDOVER (ISO 13485 / IEC 62304 aligned)

**Normative reference:** HANDOVER – Relevo Seguro de Enfermería, Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería (hereinafter, HANDOVER).

This QMS summary is intentionally lean and focused on the software lifecycle controls that are implemented in the repository. It maps the required processes to evidence in code, tests, and CI workflows.

## Quality Policy

HANDOVER commits to consistent software quality by enforcing controlled changes, automated verification, and traceable audit logging. The quality policy is implemented through GitHub pull-request review, CI pipelines, and documented audit controls. (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.github/workflows/django.yml`, `backend/audit/service.py`)

## Software Lifecycle Management (IEC 62304)

- **Planning & requirements** are maintained in documented architecture and security references in `/docs` and are reflected in code modules for FHIR handling, offline queueing, and access control. (`docs/overview-architecture.md`, `docs/fhir-and-interoperability.md`, `docs/offline-sync-and-queue.md`, `backend/api/views.py`, `src/lib/queue.ts`, `src/lib/sync.ts`)
- **Software design & implementation** follows a separation of mobile frontend and Django backend, with clear API boundaries and security components. (`backend/api/urls.py`, `backend/api/views.py`, `backend/security/auth.py`, `src/App.tsx`)
- **Maintenance** is governed by PR-based change control and CI checks before integration. (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.github/workflows/django.yml`)

## Change Management (GitHub PR-based)

- All changes are expected to be made through GitHub pull requests using a documented PR template that requires summary, scope, test evidence, and PHI/security checks. (`.github/PULL_REQUEST_TEMPLATE.md`)
- CI validates TypeScript checks, linting, FHIR validation, Vitest, and Django tests prior to merge. (`.github/workflows/ci.yml`, `.github/workflows/django.yml`)

## Verification & Validation

- **Frontend tests** validate offline queue behavior, encryption, and validation logic. (`src/lib/__tests__/queue.encryption.spec.ts`, `src/lib/__tests__/sync.offline.spec.ts`, `src/lib/__tests__/sync.validation.spec.ts`)
- **Backend tests** validate role/scope ACLs and audit behavior. (`backend/api/tests/test_role_acl.py`, `backend/audit/tests/test_audit.py`)
- **CI workflows** run automated checks on both frontend and backend. (`.github/workflows/ci.yml`, `.github/workflows/django.yml`)

## Incident & Error Handling

- API errors return structured HTTP status codes for validation and network failures, with audit events emitted for critical operations such as FHIR transactions. (`backend/api/views.py`, `backend/audit/service.py`)
- Audit ingest rejects forbidden fields and enforces controlled payload metadata. (`backend/audit/views.py`, `backend/audit/tests/test_audit.py`)

## Security & Access Governance

- **Authentication** is enforced through Auth0 JWT validation, including JWKS-based signature checks. (`backend/security/auth.py`)
- **Authorization** uses role-based and scope-based permissions for all protected endpoints. (`backend/security/permissions.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py`, `backend/api/views.py`)
- **Client-side data protection** encrypts offline payloads and stores keys in platform secure storage. (`src/lib/crypto.ts`, `src/security/secure-storage.ts`)

## Audit & Traceability

- Audit events include request IDs, user subjects, and hashed payload metadata to enable traceability without storing PHI. (`backend/audit/models.py`, `backend/audit/service.py`, `backend/audit/utils.py`, `backend/audit/middleware.py`)
- Retention is configurable and enforced by management command. (`backend/settings.py`, `backend/audit/management/commands/prune_audit.py`)

## Documentation Control

- Documentation is version-controlled in the repository and updated via PRs, ensuring traceability and review. (`docs/`, `.github/PULL_REQUEST_TEMPLATE.md`)
- Regulatory documentation is maintained alongside implementation references to ensure consistency between software and MDR artifacts. (`docs/MDR_Anexo_II_HANDOVER.md`, `docs/MDR_traceability_matrix.md`)
