# Testing y CI (backend Django + frontend pilot-grade)

## Pipeline local pilot-grade
Usa este pipeline cuando toques auth, sync/queue, FHIR mapping, validacion clinica, runtime de perfiles o `HandoverForm`.

- Pipeline completo reproducible:
  ```bash
  pnpm -w quality:pilot
  ```
- Gate de `any` en zonas sensibles:
  ```bash
  pnpm -w gate:any-sensitive
  ```
- Cobertura pilot-grade de suites criticas:
  ```bash
  pnpm -w test:pilot:coverage
  ```
- Smoke tests de formularios criticos:
  ```bash
  pnpm -w test:smoke:forms
  ```
- Validacion FHIR con fixture minima de transaccion:
  ```bash
  pnpm -w validate:fhir:fixture
  ```

## Alcance de los gates pilot-grade
La configuracion `vitest.pilot.config.ts` concentra suites reales para estos dominios:
- auth/OAuth/ACL/capabilities
- offline sync y queue
- `fhir-map` y compatibilidad publica
- validacion Zod del handover
- runtime de perfiles
- smoke tests del flujo seccionado de `HandoverForm`

La cobertura pilot-grade se evalua por archivo sobre estas rutas sensibles:
- `src/lib/auth.ts`
- `src/security/auth.tsx`
- `src/security/OAuthService.ts`
- `src/security/acl.ts`
- `src/security/capabilities.ts`
- `src/lib/queue.ts`
- `src/lib/sync.ts`
- `src/lib/fhir-map.ts`
- `src/validation/schemas.ts`
- `src/lib/profile-runtime.ts`
- `src/screens/HandoverForm.tsx`
- `src/screens/handover/submission.ts`
- `src/screens/handover/visibility.ts`

## Gate de `any` sensible
- `pnpm -w gate:any-sensitive` falla si aparece un `any`, `@ts-ignore` o `@ts-nocheck` nuevo en rutas sensibles del frontend clinico.
- El baseline actual vive en `scripts/sensitive-any-baseline.json`.
- Solo refresca el baseline si el uso nuevo es inevitable y ya quedo revisado/documentado:
  ```bash
  pnpm -w gate:any-sensitive:write
  ```

## Estrategia CI backend
La ruta de control backend se centra en **pytest-only** sobre Django/DRF:
- tests funcionales y de seguridad del backend,
- sin dependencia de servicios externos,
- con ejecucion determinista en GitHub Actions.

## Comandos locales recomendados
- Suite backend:
  ```bash
  pytest --ds=backend.settings
  ```
- Suite backend sensible (auth/FHIR/firma/auditoria/AI):
  ```bash
  pytest backend/api/tests/test_auth.py backend/api/tests/test_security_and_validation.py backend/api/tests/test_views_ai_upload_validation.py tests/test_fhir_transaction_validation.py tests/test_fhir_transaction_signatures.py tests/test_transaction_audit.py tests/test_resources_contract.py
  ```
- Cobertura backend:
  ```bash
  pytest --cov=backend
  ```
- Reproduccion cercana a CI (aislamiento de red):
  ```bash
  pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
  ```

## Variables dummy usadas en GitHub Actions
Valores de ejemplo usados en CI para evitar secretos reales y llamadas externas:
- `DJANGO_SETTINGS_MODULE=backend.settings`
- `SECRET_KEY=ci-dummy-secret-key`
- `OPENAI_API_KEY=dummy`
- `OPENAI_BASE_URL=http://127.0.0.1:9/v1`
- `HANDOVER_AI_ENABLED=0`
- `HANDOVER_OPENAI_DISABLED=1`
- `AUTH0_ISSUER_BASE_URL=https://example.invalid`
- `AUTH0_AUDIENCE=handover-api`
- `FHIR_BASE=http://127.0.0.1:9/fhir`
- `HANDOVER_FHIR_VALIDATION_MODE=off`
- `HANDOVER_REQUIRE_RBAC_ON_FHIR=true`

## Garantia de no-calls externas en CI
- Se bloquea red con `--disable-socket`.
- El bloqueo de sockets esta soportado por el plugin local de `conftest.py` (sin depender de `pytest-socket` externo).
- Solo se permiten hosts locales explicitos (`127.0.0.1`, `localhost`).
- OpenAI/Auth/FHIR usan endpoints dummy para impedir trafico real.

## Runner JS vigente
- `pnpm -w test:pilot` y `pnpm -w test:pilot:coverage` son la puerta de entrada pilot-grade para regresiones sensibles de frontend/auth/offline-sync/seguridad/FHIR.
- `pnpm -w test:smoke:forms` concentra la verificacion rapida del formulario critico por secciones.
- `pnpm -w test:unit` deja disponible el runner general de Vitest.
- `pnpm test` sigue existiendo, pero hoy ejecuta solo `jest-tests/**`; no cubre las suites modernas bajo `tests/**`, `src/**/__tests__/**` ni `src/security/__tests__/**`.
- Si tocas auth, `capabilities`, OAuth, sync u offline queue, prioriza Vitest focalizado antes de asumir que Jest te protege.

## Suites frontend sensibles recomendadas
- Auth/OAuth/capabilities:
  ```bash
  pnpm -w test:pilot
  ```
- Offline/sync:
  ```bash
  pnpm exec vitest run src/lib/__tests__/sync.offline.spec.ts src/lib/__tests__/sync.queue.spec.ts src/lib/__tests__/sync.transaction.spec.ts src/lib/__tests__/sync.validation.spec.ts tests/queue/offline-queue.spec.ts
  ```
- Formularios criticos:
  ```bash
  pnpm -w test:smoke:forms
  ```

## Cobertura minima AI/STT/uploads
- Verificar `401` sin credenciales para `transcribe`, `summarize-sbar`, `refine-sbar`, `suggest-interventions` y `audio-to-fhir`.
- Verificar `403` con token autenticado pero sin rol o scope suficiente.
- Verificar regresion feliz de `transcribe` y `upload/audio-to-fhir` con credenciales validas.
- Verificar que la proteccion no depende de `DEBUG=true`.
- Verificar que `POST /api/ai/refine-sbar` responde `400` con `invalid_refine_draft` cuando `draft` no es objeto o cuando sus campos tipados llegan con tipos no validos.
- Verificar que `POST /api/ai/refine-sbar` responde `400` con `invalid_refine_handover` cuando `handover` llega explicitamente con tipo no objeto.

## Estado actual de confianza
- Las suites top-level de FHIR sensible (`tests/test_fhir_transaction_validation.py`, `tests/test_fhir_transaction_signatures.py`, `tests/test_transaction_audit.py`, `tests/test_resources_contract.py`) deben ejecutarse sin depender de `respx`.
- `src/security/__tests__/**` forma parte de la regresion sensible de Vitest y no debe quedar fuera por exclusiones globales.
- Queda convivencia de runners (`pytest`, `vitest`, `jest`) por historia del repo; no introduzcas un cuarto sistema de tests.
- `jest-tests/**` sigue siendo legacy y util para compatibilidad puntual, pero no sustituye la bateria sensible moderna.

## Storage sensible
- Ejecuta tambien `pytest backend/api/tests/test_handover_etl_read.py backend/api/tests/test_icea_transaction.py backend/api/tests/test_icea_bridge.py` cuando cambies retencion, ETL readback o persistencia clinica.
- Las regresiones de retencion/cifrado del Bundle clinico y pruning de artefactos sensibles deben cubrirse en tests backend focalizados.
- La bateria sensible debe cubrir compatibilidad backward de descifrado usando `encryption_metadata.key_source`, incluyendo bundles legacy `secret_key_derived` leidos despues de activar `HANDOVER_BUNDLE_ENCRYPTION_KEY`.
- En bridge retry/requeue, los tests deben distinguir `stored_bundle_unavailable` (bundle presente pero ilegible) de `handover_bundle_not_found` (bundle ausente/expirado/no localizable).

