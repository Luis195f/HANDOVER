# Pruebas y CI

## Comandos principales
- Revisar tipos: `pnpm -w typecheck`
- Linter: `pnpm -w lint`
- Unit/integration: `pnpm -w vitest run --reporter=verbose`
- Cobertura: `pnpm -w vitest run --reporter=verbose --coverage`
- Validación de bundles FHIR: `pnpm validate:fhir`

## Cobertura
- Umbral mínimo esperado: ≥ 80 % definido en `vitest.config.ts`.
- El reporte HTML se genera en `coverage/unit/index.html` y el `lcov.info` en `coverage/unit/lcov.info` para integraciones externas.

## CI
- Pipeline basado en Node 20 y pnpm 10.
- El paso de instalación está marcado como no bloqueante (`continue-on-error: true`) para mitigar errores del registry npm; revisar los logs de `Install` si el workflow pasa con advertencias.

## Validación FHIR en pipelines
- Usa `pnpm validate:fhir` o el script `scripts/validate-fhir.ts` para validar bundles antes de publicarlos.
- `HANDOVER_FHIR_VALIDATION_MODE` controla si el backend hace validación remota (`remote`) o la omite (`off`).
