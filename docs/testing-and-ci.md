# Testing y CI (estado real del repo)

## Runner principal

- `pnpm test` / `pnpm -w test` es el runner principal de tests JavaScript del repo.
- Ese comando ejecuta `vitest.pilot.config.ts`, la bateria pilot-grade que ya respalda el gate sensible de CI.
- Para el backend Django/DRF, el runner vigente sigue siendo `pytest`; no se introduce un cuarto sistema.

## Cuándo usar runners secundarios

- `pnpm -w test:pilot:coverage:ci`: misma bateria pilot-grade, pero con reportes `lcov` + `cobertura` para CI.
- `pnpm -w test:unit`: Vitest general para explorar regresiones fuera del gate pilot-grade o ampliar cobertura durante desarrollo.
- `pnpm -w test:smoke:forms`: smoke rápido del flujo crítico de `HandoverForm`.
- `pnpm -w test:legacy`: Jest legacy solo para `jest-tests/**` o cuando se toca compatibilidad histórica que todavía no migró a Vitest.
- `pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests`: runner backend más cercano a GitHub Actions.

## Pipeline local pilot-grade

Usa este pipeline cuando toques auth, sync/queue, FHIR mapping, validación clínica, runtime de perfiles o `HandoverForm`.

- Validación operativa principal:
  ```bash
  pnpm -w quality:pilot
  ```
- Gate de `any` en zonas sensibles:
  ```bash
  pnpm -w gate:any-sensitive
  ```
- Cobertura pilot-grade local:
  ```bash
  pnpm -w test:pilot:coverage
  ```
- Validación FHIR con fixtures representativas versionadas:
  ```bash
  pnpm -w validate:fhir
  ```

## Alcance del gate pilot-grade

La configuración `vitest.pilot.config.ts` concentra suites reales para estos dominios:

- auth, OAuth, ACL y capabilities
- offline sync y queue
- `fhir-map` y compatibilidad pública
- validación Zod del handover
- runtime de perfiles
- smoke tests del flujo seccionado de `HandoverForm`
- regresión contextual de perfiles, MPAC/prioridad visible y `fhir-composition`

La cobertura pilot-grade se evalúa por archivo sobre estas rutas sensibles:

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

- `pnpm -w gate:any-sensitive` falla si aparece un `any`, `@ts-ignore` o `@ts-nocheck` nuevo en rutas sensibles del frontend clínico.
- El baseline actual vive en `scripts/sensitive-any-baseline.json`.
- Solo refresca el baseline si el uso nuevo es inevitable y ya quedó revisado y documentado:
  ```bash
  pnpm -w gate:any-sensitive:write
  ```

## Estrategia CI backend

La ruta de control backend se centra en `pytest` sobre Django/DRF:

- tests funcionales y de seguridad del backend
- sin dependencia de servicios externos
- con ejecución determinista en GitHub Actions

Comandos locales recomendados:

- Suite backend:
  ```bash
  pytest --ds=backend.settings
  ```
- Suite backend sensible (auth/FHIR/firma/auditoría/AI):
  ```bash
  pytest backend/api/tests/test_auth.py backend/api/tests/test_security_and_validation.py backend/api/tests/test_views_ai_upload_validation.py tests/test_fhir_transaction_validation.py tests/test_fhir_transaction_signatures.py tests/test_transaction_audit.py tests/test_resources_contract.py
  ```
- Cobertura backend:
  ```bash
  pytest --cov=backend
  ```
- Reproducción cercana a CI:
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

## Garantía de no-calls externas en CI

- Se bloquea red con `--disable-socket`.
- El bloqueo de sockets está soportado por el plugin local de `conftest.py`.
- Solo se permiten hosts locales explícitos (`127.0.0.1`, `localhost`).
- OpenAI, Auth y FHIR usan endpoints dummy para impedir tráfico real.

## Política mínima del workflow CI principal

- El workflow `CI` instala dependencias con `pnpm install --frozen-lockfile` tanto en `pull_request` como en `push`.
- El paso JS principal de CI usa `pnpm -w test:pilot:coverage:ci`, que es la misma batería que `pnpm test` con reportes extra para artefactos.
- `lint:ci` es el comando de referencia para lint estricto en CI.

## Topología de runners vigente

- `pnpm test` es la puerta de entrada JS para cambios clínicos y operativos sensibles.
- `pnpm -w test:unit` convive como runner secundario de Vitest para exploración más amplia.
- `pnpm -w test:legacy` sigue existiendo por historia del repo, pero no sustituye la batería moderna bajo `tests/**`, `src/**/__tests__/**` y `src/security/__tests__/**`.
- `pytest` sigue siendo la fuente de verdad para backend Django/DRF.
- No elimines Jest o jobs existentes sin demostrar antes que su cobertura histórica ya quedó absorbida por Vitest o `pytest`.

## Suites frontend sensibles recomendadas

- Auth, OAuth y capabilities:
  ```bash
  pnpm test
  ```
- Offline y sync:
  ```bash
  pnpm exec vitest run src/lib/__tests__/sync.offline.spec.ts src/lib/__tests__/sync.queue.spec.ts src/lib/__tests__/sync.transaction.spec.ts src/lib/__tests__/sync.validation.spec.ts tests/queue/offline-queue.spec.ts
  ```
- Formularios críticos:
  ```bash
  pnpm -w test:smoke:forms
  ```

## Cobertura mínima AI, STT y uploads

- Verificar `401` sin credenciales para `transcribe`, `summarize-sbar`, `refine-sbar`, `suggest-interventions` y `audio-to-fhir`.
- Verificar `403` con token autenticado pero sin rol o scope suficiente.
- Verificar regresión feliz de `transcribe` y `upload/audio-to-fhir` con credenciales válidas.
- Verificar que la protección no depende de `DEBUG=true`.
- Verificar que `POST /api/ai/refine-sbar` responde `400` con `invalid_refine_draft` cuando `draft` no es objeto o cuando sus campos tipados llegan con tipos no válidos.
- Verificar que `POST /api/ai/refine-sbar` responde `400` con `invalid_refine_handover` cuando `handover` llega explícitamente con tipo no objeto.

## Estado actual de confianza

- Las suites top-level de FHIR sensible (`tests/test_fhir_transaction_validation.py`, `tests/test_fhir_transaction_signatures.py`, `tests/test_transaction_audit.py`, `tests/test_resources_contract.py`) deben ejecutarse sin depender de `respx`.
- `src/security/__tests__/**` forma parte de la regresión sensible de Vitest y no debe quedar fuera por exclusiones globales.
- La convivencia actual es `pytest` + `vitest` + `jest` legacy; no introduzcas un cuarto sistema.
- `jest-tests/**` sigue siendo útil para compatibilidad puntual, pero ya no es el runner por defecto del repo.

## Storage sensible

- Ejecuta también `pytest backend/api/tests/test_handover_etl_read.py backend/api/tests/test_icea_transaction.py backend/api/tests/test_icea_bridge.py` cuando cambies retención, ETL readback o persistencia clínica.
- Ejecuta tambien `pytest backend/api/tests/test_icea_ops_api.py backend/api/tests/test_icea_webhook.py` cuando cambies observabilidad operativa, redaccion segura o contratos `/api/icea/ops/*`.
- Ejecuta tambien `pnpm exec vitest run tests/admin-api.spec.ts tests/AdminDashboardScreen.spec.tsx tests/screens/SupervisorDashboard.spec.tsx` cuando cambies la UX de supervisor/admin para observabilidad ICEA.
- Si tocas degradacion por feature flags o `available=false`, verifica tambien los contratos disabled de `/api/icea/ops/summary`, `/api/icea/ops/events` y `/api/icea/ops/unit/<unitId>` para evitar regresiones a `invalid_payload`.
- Las regresiones de retención, cifrado del Bundle clínico y pruning de artefactos sensibles deben cubrirse en tests backend focalizados.
- La batería sensible debe cubrir compatibilidad backward de descifrado usando `encryption_metadata.key_source`, incluyendo bundles legacy `secret_key_derived` leídos después de activar `HANDOVER_BUNDLE_ENCRYPTION_KEY`.
- En bridge retry y requeue, los tests deben distinguir `stored_bundle_unavailable` de `handover_bundle_not_found`.
