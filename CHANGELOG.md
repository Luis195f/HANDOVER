# Changelog

## v0.4.0-rc.1 — 2025-02-XX

### Added
- Validación estructural de bundles FHIR con esquema Zod compartido entre tests y CLI.
- Suite `__tests__/fhir/bundle-validation.spec.ts` cubriendo Bundle, Observation, MedicationStatement, DeviceUseStatement, Procedure, DocumentReference y Composition.
- CLI `scripts/validate-fhir.ts` para validar bundles JSON fuera de Vitest (`pnpm validate:fhir`).
- Pipeline CI (`.github/workflows/ci.yml`) con jobs de typecheck, lint y `pnpm vitest run --reporter=verbose`.
- Documentación actualizada: README (setup, autenticación, permisos), `docs/DEPLOY.md` (Android/iOS/Web) y notas de lanzamiento.

### Changed
- Refuerzo de referencias en Composition/Encounter para asegurar coherencia de secciones y recursos.

### Fixed
- Validaciones adicionales sobre DeviceUseStatement y composición de oxigenoterapia para evitar bundles incompletos.
