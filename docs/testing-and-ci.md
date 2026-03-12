# Testing y CI (backend Django)

## Estrategia CI backend
La ruta de control backend se centra en **pytest-only** sobre Django/DRF:
- tests funcionales y de seguridad del backend,
- sin dependencia de servicios externos,
- con ejecución determinista en GitHub Actions.

## Comandos locales recomendados
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
- Reproducción cercana a CI (aislamiento de red):
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
- El bloqueo de sockets está soportado por el plugin local de `conftest.py` (sin depender de `pytest-socket` externo).
- Sólo se permiten hosts locales explícitos (`127.0.0.1`, `localhost`).
- OpenAI/Auth/FHIR usan endpoints dummy para impedir tráfico real.

## Resultado esperado
- CI valida calidad backend (tests + cobertura) sin exponer PHI ni depender de infra de terceros.

## Runner JS vigente
- `pnpm exec vitest run <targets>` es el runner activo para regresiones sensibles de frontend/auth/offline-sync/seguridad.
- `pnpm test` sigue existiendo, pero hoy ejecuta solo `jest-tests/**`; no cubre las suites modernas bajo `tests/**`, `src/**/__tests__/**` ni `src/security/__tests__/**`.
- Si tocas auth, `capabilities`, OAuth, sync u offline queue, prioriza Vitest focalizado antes de asumir que Jest te protege.

## Suites frontend sensibles recomendadas
- Auth/OAuth/capabilities:
  ```bash
  pnpm exec vitest run tests/security/auth.spec.ts tests/security/auth.refresh.spec.ts tests/security/oauth-service.spec.ts src/security/__tests__/auth.refresh.spec.ts src/security/__tests__/auth.logout.spec.ts src/security/__tests__/auth.capabilities-cache.spec.tsx
  ```
- Offline/sync:
  ```bash
  pnpm exec vitest run tests/queue/offline-queue.spec.ts src/lib/__tests__/sync.offline.spec.ts src/lib/__tests__/sync.test.ts
  ```

## Cobertura mínima AI/STT/uploads
- Verificar `401` sin credenciales para `transcribe`, `summarize-sbar`, `refine-sbar`, `suggest-interventions` y `audio-to-fhir`.
- Verificar `403` con token autenticado pero sin rol o scope suficiente.
- Verificar regresión feliz de `transcribe` y `upload/audio-to-fhir` con credenciales válidas.
- Verificar que la protección no depende de `DEBUG=true`.

## Estado actual de confianza
- Las suites top-level de FHIR sensible (`tests/test_fhir_transaction_validation.py`, `tests/test_fhir_transaction_signatures.py`, `tests/test_transaction_audit.py`, `tests/test_resources_contract.py`) deben ejecutarse sin depender de `respx`.
- `src/security/__tests__/**` forma parte de la regresión sensible de Vitest y no debe quedar fuera por exclusiones globales.
- Queda convivencia de runners (`pytest`, `vitest`, `jest`) por historia del repo; no introduzcas un cuarto sistema de tests.
- `jest-tests/**` sigue siendo legacy y útil para compatibilidad puntual, pero no sustituye la batería sensible moderna.

## Storage sensible
- Ejecuta también `pytest backend/api/tests/test_handover_etl_read.py backend/api/tests/test_icea_transaction.py backend/api/tests/test_icea_bridge.py` cuando cambies retención, ETL readback o persistencia clínica.
- Las regresiones de retención/cifrado del Bundle clínico y pruning de artefactos sensibles deben cubrirse en tests backend focalizados.
