# Release Notes — borrador heredado no verificado

> Estado del documento
> - Estado: `legacy-unverified`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: árbol actual del repo, `git tag --list`, `git log --oneline --decorate -n 15`, `.github/workflows/ci.yml`, `docs/DEPLOY.md`.
> - Riesgos o lagunas abiertas: no existe un tag Git local verificable para `v0.4.0-rc.1`; por eso este archivo no debe presentarse como notas de una versión publicada.

Este archivo preserva un resumen heredado de capacidades observables del repo alrededor de una RC documentada, pero no verificada como release publicado.

## Borrador heredado rotulado `v0.4.0-rc.1`

## 🔐 Seguridad
- Inicio de sesión OIDC con manejo resiliente de tokens (refresh, revocación y almacenamiento seguro).
- `safeFetch` endurece las llamadas de red: timeouts por intento, reintentos exponenciales y bloqueo de HTTP en producción.
- Auditoría de permisos móviles para cámara, audio y notificaciones con mensajes claros para el personal clínico.
- Documentación explícita de guardias RBAC (`src/security/acl.ts`) y variables de entorno para controlar unidades clínicas.

## ✅ Pruebas
- `pnpm test` pasa a ser el runner principal JS del repo y ejecuta la batería Vitest pilot-grade.
- CI mantiene `pnpm -w test:pilot:coverage:ci` para la misma batería con artefactos `lcov` + `Cobertura`.
- `pytest` sigue siendo la fuente de verdad para Django/DRF; `Jest` queda como runner legacy puntual para `jest-tests/**`.
- Cobertura ampliada en `tests/security/` para roles/ACL y en `tests/fhir-client.spec.ts` para contratos FHIR.
- Validación automatizada de bundles mediante `scripts/validate-fhir.ts` y pruebas de contrato en Python (`tests/test_resources_contract.py`).
- Nuevos umbrales ≥ 80 % documentados y reporte `coverage/pilot-grade/lcov.info` para análisis.

## 🌐 FHIR & Offline
- Cliente FHIR mejora el manejo de OperationOutcome e incluye cabeceras idempotentes al subir bundles.
- Cola offline sincroniza bundles con reconexión inteligente y notifica errores a la UI.
- Prefill SBAR + validaciones zod aseguran datos clínicos consistentes antes del envío.
- Guía de pruebas manuales (UCI/Urgencias) para validar offline, RBAC y validación FHIR previo al RC.

## 🚀 Release Candidate
- Documentación operativa actualizada (`README.md`, `docs/DEPLOY.md`, `docs/testing-and-ci.md`).
- Topología prioritaria explícita para piloto: exportación web estática a staging con `Dockerfile` + `docker-compose.yml`; backend Django separado vía `Procfile`.
- `.github/workflows/python-publish.yml` queda desactivado como workflow residual porque el repo no define un paquete Python publicable.
- `scripts/zip-project.ps1`, `.gitignore` y `.dockerignore` excluyen bases locales, secretos y artefactos runtime de entregables y contexto Docker.
- Checklist para generar artefactos Android/iOS/Web y publicar el tag que realmente se vaya a emitir.
- Próximos pasos: validar artefactos con personal clínico y recopilar retroalimentación antes de una release estable posterior realmente etiquetada.
- Política simple: para piloto, la fuente de verdad del release es el tag Git más este archivo; las versiones `1.0.0` de `package.json` y `app.config.ts` siguen siendo metadatos de build locales.
