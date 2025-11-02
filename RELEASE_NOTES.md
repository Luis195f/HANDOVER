# Release Notes — v0.4.0-rc.1

Semana 4 se enfoca en cerrar brechas de seguridad, robustecer la suite de pruebas y preparar el release candidate para validación clínica.

## 🔐 Seguridad
- Inicio de sesión OIDC con manejo resiliente de tokens (refresh, revocación y almacenamiento seguro).
- `safeFetch` endurece las llamadas de red: timeouts por intento, reintentos exponenciales y bloqueo de HTTP en producción.
- Auditoría de permisos móviles para cámara, audio y notificaciones con mensajes claros para el personal clínico.
- Documentación explícita de guardias RBAC (`src/security/acl.ts`) y variables de entorno para controlar unidades clínicas.

## ✅ Pruebas
- CI ejecuta `pnpm -w typecheck`, `pnpm -w lint` y `pnpm -w vitest run --reporter=verbose` con cache PNPM.
- Cobertura ampliada en `tests/security/` para roles/ACL y en `tests/fhir-client.spec.ts` para contratos FHIR.
- Validación automatizada de bundles mediante `scripts/validate-fhir.ts` y pruebas de contrato en Python (`tests/test_resources_contract.py`).
- Nuevos umbrales ≥ 80 % documentados y reportes `coverage/unit/index.html` + `lcov.info` para análisis.

## 🌐 FHIR & Offline
- Cliente FHIR mejora el manejo de OperationOutcome e incluye cabeceras idempotentes al subir bundles.
- Cola offline sincroniza bundles con reconexión inteligente y notifica errores a la UI.
- Prefill SBAR + validaciones zod aseguran datos clínicos consistentes antes del envío.
- Guía de pruebas manuales (UCI/Urgencias) para validar offline, RBAC y validación FHIR previo al RC.

## 🚀 Release Candidate
- Documentación actualizada (`README.md`, `docs/DEPLOY.md`, `CHANGELOG.md`).
- Checklist para generar artefactos Android/iOS/Web y publicar el tag `v0.4.0-rc.1`.
- Próximos pasos: validar artefactos con personal clínico y recopilar retroalimentación antes de `v0.4.0` estable.
- Nota operativa: el job Node en GitHub Actions es no bloqueante para sortear errores `403` del registry; revisar logs del paso `Install` durante la verificación.
