# Changelog

> Estado del documento
> - Estado: `legacy-unverified`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: árbol actual del repo, `git tag --list`, `git log --oneline --decorate -n 15`.
> - Riesgos o lagunas abiertas: este archivo conserva una narrativa heredada de release bajo la etiqueta `v0.4.0-rc.1`, pero en este corte no existe un tag Git local verificable con ese nombre.

Este archivo se mantiene como resumen documental útil de cambios observables del repo. No debe leerse como prueba de un release publicado mientras no exista un tag Git verificable que respalde la etiqueta.

## Draft heredado rotulado `v0.4.0-rc.1` (`legacy-unverified`)

### Seguridad y permisos
- Autenticación OIDC reforzada con almacenamiento seguro y refresco de tokens (`src/lib/auth.ts`).
- Validaciones de red endurecidas: `safeFetch` impide HTTP en producción y añade reintentos/timeout configurables.
- Revisiones de permisos móviles con mensajes localizados para cámara, audio y notificaciones (`app.config.ts`).
- Guardias RBAC centralizadas (`src/security/acl.ts`) documentadas en README para un onboarding consistente.

### Pruebas y calidad
- Migración a Vitest para unitarias/integración con reporter verboso en CI.
- Nuevas suites en `tests/security/` y `tests/fhir-client.spec.ts` cubren ACL, tokens y contratos FHIR.
- Script `scripts/validate-fhir.ts` y pruebas de contrato Python aseguran conformidad con perfiles FHIR.
- Umbral de cobertura elevado a 80 % (líneas/funciones/estatements) y documentación de reportes HTML/LCOV.

### Offline y FHIR
- Cola offline endurecida para reintentos con idempotencia al enviar bundles.
- Prefill de pacientes y validaciones SBAR con nuevas ayudas en `src/lib/fhir-client.ts` y `src/validation/`.

### DevEx y CI/CD
- Documentación actualizada (`README.md`, `docs/DEPLOY.md`) con flujos de setup, pruebas y builds.
- Nuevo workflow `.github/workflows/ci.yml` con jobs paralelos (typecheck, lint, vitest) utilizando PNPM cacheado en GitHub Actions.
- Guía de release candidate que detalla generación de artefactos y un proceso RC documentado, sin que esa etiqueta implique un tag Git verificado en este corte.
- En el estado actual del repo, el job Node de `CI` es bloqueante; esta línea se conserva solo como parte del borrador heredado y no debe tomarse como estado vigente.
