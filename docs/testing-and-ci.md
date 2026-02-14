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
