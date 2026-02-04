# Traceability Matrix (MDR-friendly, MVP)

| Requisito | Implementación (código) | Tests | Evidencia doc |
| --- | --- | --- | --- |
| Timeout de sesión (inactividad + hard logout) | `src/security/session-timeout.ts`, `src/security/SessionTimeoutProvider.tsx`, `src/security/session-config.ts` | `src/security/__tests__/session-timeout.spec.ts`, `src/security/__tests__/auth.logout.spec.ts` | `docs/SECURITY_HARDENING.md` |
| Purga en logout (colas/borradores/keys) | `src/security/auth.tsx`, `src/security/secure-cleanup.ts` | `src/security/__tests__/auth.logout.spec.ts` | `docs/SECURITY_HARDENING.md` |
| 422 por Bundle inválido + estructura mínima | `backend/api/views.py` | `backend/api/tests/test_security_and_validation.py`, `backend/api/tests/test_handover_api.py` | `docs/SECURITY_HARDENING.md` |
| Scopes clínicos + capacidades + perfiles FHIR | `backend/security/scopes.py`, `backend/api/views.py`, `src/security/capabilities.ts` | `backend/api/tests/test_role_acl.py` | `docs/SECURITY_HARDENING.md` |
| Auditoría (hash sin PHI) | `backend/audit/service.py`, `backend/audit/views.py`, `main.py` | `backend/audit/tests/test_audit.py` | `docs/SECURITY_HARDENING.md` |
| Dataset sintético demo | `demo/fhir-bundles/*.json` | N/A (validación manual) | `docs/MVP_DEMO.md` |
| IA SBAR segura + guardrails | `backend/ai_client.py`, `main.py` | `backend/tests/test_ai_prompting.py` | `docs/SECURITY_HARDENING.md` |
