# Security Hardening (Clínico/MDR)

## Sesión clínica segura

- **Timeout de inactividad**: se corta la sesión tras un periodo configurable de inactividad (`EXPO_PUBLIC_SESSION_IDLE_MINUTES`, por defecto 15 minutos). La lógica se implementa en el controlador de timeout de sesión y se ejecuta en `SessionTimeoutProvider` con logout seguro y limpieza de datos locales sensibles.【F:src/security/session-timeout.ts†L1-L74】【F:src/security/SessionTimeoutProvider.tsx†L1-L58】
- **Hard logout**: se fuerza un cierre de sesión por tiempo máximo de sesión (`EXPO_PUBLIC_SESSION_HARD_MINUTES`, por defecto 30 minutos). Esto evita sesiones clínicas largas sin re-autenticación.【F:src/security/session-timeout.ts†L1-L74】【F:src/security/session-config.ts†L1-L29】
- **Limpieza de datos locales en logout**: se eliminan colas offline, borradores, claves y cache de capacidades para reducir exposición de PHI/PII en dispositivo.【F:src/security/auth.tsx†L904-L936】【F:src/security/secure-cleanup.ts†L1-L20】

## Sanitización de errores y PHI

- **Cliente**: se elimina el log de roles/modo de sesión en navegación para evitar exposición accidental de datos sensibles en consola.【F:src/navigation/RootNavigator.tsx†L80-L100】
- **Servidor y ruta móvil `/api/audit`**: la auditoría registra hashes/tamaño de payload y usa un `patientKey` canónico determinista derivado con secreto de servidor (`ptk2_*`) para persistencia y lectura. El cliente móvil todavía genera un seudónimo de compatibilidad `ptk_` en transporte; el backend lo acepta solo por compatibilidad y lo canoniza a `ptk2_*` al persistir. `POST /api/audit` rechaza `patientId`, referencias equivalentes y blobs/meta de alto riesgo; `GET /api/audit` devuelve solo el `patientKey` canónico y nunca serializa `meta`. Además, el logger estructurado omite `meta` y cualquier `resource_id` de tipo `Patient` se persiste/loguea como `patientKey`, no como ID crudo. Esto reduce exposición de identificadores técnicos dentro de esta ruta, pero sigue siendo seudonimización para correlación operativa, no anonimización, y no debe venderse como transición end-to-end completa del transporte móvil a `ptk2_*`. Esto aplica a eventos de auditoría estándar y a los nuevos eventos de IA (hash + metadatos de modelo).【F:backend/audit/service.py†L31-L208】【F:backend/api/audit_pseudonymization.py†L1-L110】【F:backend/api/views.py†L123-L203】【F:backend/api/views.py†L2149-L2184】【F:backend/api/views_ai.py†L444-L598】【F:backend/api/migrations/0015_sanitize_client_audit_event_meta.py†L1-L106】【F:backend/api/migrations/0016_rotate_client_audit_patient_keys_v2.py†L1-L58】【F:src/lib/audit.ts†L1-L257】

## Seguridad de API y validaciones finales

- **Validación mínima de Bundle**: se valida estructura mínima (resourceType, type=transaction, entries con resourceType) antes de aceptar transacciones FHIR; errores son 422 con estructura consistente y código de error `INVALID_BUNDLE`.【F:backend/api/views.py†L186-L231】【F:backend/api/views.py†L508-L574】
- **Scopes clínicos**: se define catálogo mínimo de scopes y se expone en `/api/me/capabilities` junto con perfiles FHIR soportados.【F:backend/security/scopes.py†L1-L19】【F:backend/api/views.py†L329-L369】
- **Auditoría de IA**: cada resumen SBAR genera evento de auditoría (`ai_summary_generated`) con hash del input y metadatos (modelo, versión).【F:backend/api/views_ai.py†L444-L598】

## CSP (django-csp)

- **Formato actualizado**: la política CSP se mantiene en `CONTENT_SECURITY_POLICY` con el formato esperado por `django-csp >= 4.0` y se restringe a orígenes explícitos (self + CDNs de fuentes/scripts y orígenes HTTPS permitidos por CORS). Esto evita fallos de `manage.py check/migrate` por formato antiguo y mantiene el endurecimiento sin abrir la política.【F:backend/settings.py†L210-L232】【F:requirements.txt†L14】

## Variables de entorno relevantes

- `EXPO_PUBLIC_SESSION_IDLE_MINUTES`: minutos de inactividad antes de logout (default 15).【F:src/security/session-config.ts†L5-L29】
- `EXPO_PUBLIC_SESSION_HARD_MINUTES`: minutos máximos de sesión antes de logout (default 30).【F:src/security/session-config.ts†L5-L29】
