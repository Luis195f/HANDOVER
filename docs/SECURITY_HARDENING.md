# Security Hardening (Clínico/MDR)

## Sesión clínica segura

- **Timeout de inactividad**: se corta la sesión tras un periodo configurable de inactividad (`EXPO_PUBLIC_SESSION_IDLE_MINUTES`, por defecto 15 minutos). La lógica se implementa en el controlador de timeout de sesión y se ejecuta en `SessionTimeoutProvider` con logout seguro y limpieza de datos locales sensibles.【F:src/security/session-timeout.ts†L1-L74】【F:src/security/SessionTimeoutProvider.tsx†L1-L58】
- **Hard logout**: se fuerza un cierre de sesión por tiempo máximo de sesión (`EXPO_PUBLIC_SESSION_HARD_MINUTES`, por defecto 30 minutos). Esto evita sesiones clínicas largas sin re-autenticación.【F:src/security/session-timeout.ts†L1-L74】【F:src/security/session-config.ts†L1-L29】
- **Limpieza de datos locales en logout**: se eliminan colas offline, borradores, claves y cache de capacidades para reducir exposición de PHI/PII en dispositivo.【F:src/security/auth.tsx†L904-L936】【F:src/security/secure-cleanup.ts†L1-L20】

## Sanitización de errores y PHI

- **Cliente**: se elimina el log de roles/modo de sesión en navegación para evitar exposición accidental de datos sensibles en consola.【F:src/navigation/RootNavigator.tsx†L80-L100】
- **Servidor**: la auditoría registra hashes/tamaño de payload, no contenido clínico. Esto aplica a eventos de auditoría estándar y a los nuevos eventos de IA (hash + metadatos de modelo).【F:backend/audit/service.py†L31-L180】【F:main.py†L211-L343】

## Seguridad de API y validaciones finales

- **Validación mínima de Bundle**: se valida estructura mínima (resourceType, type=transaction, entries con resourceType) antes de aceptar transacciones FHIR; errores son 422 con estructura consistente y código de error `INVALID_BUNDLE`.【F:backend/api/views.py†L186-L231】【F:backend/api/views.py†L508-L574】
- **Scopes clínicos**: se define catálogo mínimo de scopes y se expone en `/api/me/capabilities` junto con perfiles FHIR soportados.【F:backend/security/scopes.py†L1-L19】【F:backend/api/views.py†L329-L369】
- **Auditoría de IA**: cada resumen SBAR genera evento de auditoría (`ai_summary_generated`) con hash del input y metadatos (modelo, versión).【F:main.py†L211-L343】

## Variables de entorno relevantes

- `EXPO_PUBLIC_SESSION_IDLE_MINUTES`: minutos de inactividad antes de logout (default 15).【F:src/security/session-config.ts†L5-L29】
- `EXPO_PUBLIC_SESSION_HARD_MINUTES`: minutos máximos de sesión antes de logout (default 30).【F:src/security/session-config.ts†L5-L29】
