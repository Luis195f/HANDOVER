# MDR Traceability Matrix – HANDOVER

**Normative reference:** HANDOVER – Relevo Seguro de Enfermería, Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería (hereinafter, HANDOVER).

| MDR Requirement | Description | Implementation | Evidence |
| --- | --- | --- | --- |
| Annex II §1.1 | Device description and intended purpose | Frontend + backend architecture, FHIR transaction handling | `docs/overview-architecture.md`, `backend/api/views.py`, `backend/api/urls.py` |
| Annex II §1.3 | Design and development information | Separation of React Native client and Django API | `src/App.tsx`, `backend/api/views.py` |
| Annex II §1.4 | Access control | Auth0 JWT validation + role/scope enforcement | `backend/security/auth.py`, `backend/security/permissions.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py` |
| Annex II §1.4 | Capabilities disclosure | `/api/me/capabilities` exposes role/scope permissions | `backend/api/views.py`, `backend/api/urls.py` |
| Annex II §1.5 | Risk control (data integrity) | FHIR bundle validation and transaction type enforcement | `backend/api/views.py` |
| Annex II §1.6 | Audit trail | Event-based audit with hashed payload metadata and request ID | `backend/audit/models.py`, `backend/audit/service.py`, `backend/audit/utils.py`, `backend/audit/middleware.py` |
| Annex II §1.6 | Audit ingestion endpoint | Controlled audit ingest with role/scope enforcement | `backend/audit/views.py`, `backend/security/permissions_roles.py`, `backend/security/scope_permissions.py` |
| Annex II §1.7 | Data protection | Offline queue encryption and secure key storage | `src/lib/queue.ts`, `src/lib/crypto.ts`, `src/security/secure-storage.ts` |
| Annex II §1.8 | Verification & validation | Automated tests for ACL, audit, and offline queue | `backend/api/tests/test_role_acl.py`, `backend/audit/tests/test_audit.py`, `src/lib/__tests__/queue.encryption.spec.ts`, `src/lib/__tests__/sync.offline.spec.ts`, `src/lib/__tests__/sync.validation.spec.ts` |
| Annex II §1.8 | CI enforcement | CI workflows run lint, typecheck, Vitest, and Django tests | `.github/workflows/ci.yml`, `.github/workflows/django.yml` |
| Annex II §1.9 | Post-market surveillance (software) | Audit logging + retention and PR/CI-controlled updates | `backend/audit/service.py`, `backend/audit/management/commands/prune_audit.py`, `.github/PULL_REQUEST_TEMPLATE.md` |
