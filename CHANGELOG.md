# Changelog

## [v0.4.0-rc.1] - 2024-09-20

### Seguridad y permisos
- Autenticación OIDC reforzada con almacenamiento seguro y refresco de tokens (`src/lib/auth.ts`).
- Validaciones de red endurecidas: `safeFetch` impide HTTP en producción y añade reintentos/timeout configurables.
- Revisiones de permisos móviles con mensajes localizados para cámara, audio y notificaciones (`app.json`).
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
- Nuevo workflow `ci.yml` con jobs paralelos (typecheck, lint, vitest) utilizando PNPM cacheado en GitHub Actions.
- Guía de release candidate que detalla generación de artefactos y publicación del tag `v0.4.0-rc.1`.
- Job Node marcado como no bloqueante para tolerar errores `403` de registry y documentado en README/DEPLOY.
