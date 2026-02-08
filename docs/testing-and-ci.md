# Pruebas y CI

## Comandos principales
- Revisar tipos: `pnpm -w typecheck`
- Linter: `pnpm -w lint`
- Unit/integration: `pnpm -w vitest run --reporter=verbose`
- Cobertura: `pnpm -w vitest run --reporter=verbose --coverage`
- E2E (Playwright): `pnpm run test:e2e`
- Validación de bundles FHIR: `pnpm validate:fhir`

## Cobertura
- Umbral mínimo esperado: ≥ 80 % definido en `vitest.config.ts`.
- El reporte HTML se genera en `coverage/unit/index.html` y el `lcov.info` en `coverage/unit/lcov.info` para integraciones externas.

## CI
- Pipeline basado en Node 20 y pnpm 10.
- Ejecuta typecheck, lint, tests unit/integration con cobertura, pruebas E2E y validación FHIR en cada push/PR a `main`.
- El paso de instalación está marcado como no bloqueante (`continue-on-error: true`) para mitigar errores del registry npm; revisar los logs de `Install` si el workflow pasa con advertencias.
- El reporte `coverage/unit/lcov.info` se sube como artefacto `coverage-unit` para integraciones externas.

## Pruebas E2E (Playwright)
- Configuradas en `tests/e2e` con `playwright.config.ts` y ejecución vía `pnpm run test:e2e`.
- El servidor web arranca con `EXPO_PUBLIC_E2E=true` para habilitar stubs de cámara/audio y atajos de firma.
- Para crear nuevas pruebas:
  1. Añade un spec en `tests/e2e/`.
  2. Reutiliza `data-testid` en pantallas críticas (Login, QR, Audio, Firmas).
  3. Mockea llamadas HTTP con `page.route()` cuando no haya backend disponible.

## Validación FHIR en pipelines
- Usa `pnpm validate:fhir` o el script `scripts/validate-fhir.ts` para validar bundles antes de publicarlos.
- `HANDOVER_FHIR_VALIDATION_MODE` controla si el backend hace validación remota (`remote`) o la omite (`off`).
