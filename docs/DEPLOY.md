# Despliegue y release piloto

> Estado del documento
> - Estado: `pilot`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: `.github/workflows/deploy-staging.yml`, `.github/workflows/backup.yml`, `Dockerfile`, `docker-compose.yml`, `Procfile`, `scripts/release-rehearsal.ps1`, `docs/release-rehearsal.md`, `docs/backup-restore-drill.md`, `git tag --list`.
> - Riesgos o lagunas abiertas: la topología documentada es real para la web estática de staging, pero el backend sigue fuera de `docker-compose.yml` y el versionado de release requiere tag Git verificable.

Esta guía describe el estado real del despliegue en HANDOVER y deja una topología prioritaria explícita para el piloto.

## Topología objetivo prioritaria

La topología prioritaria que hoy sí está respaldada por archivos reales del repo es esta:

- Frontend web exportado con Expo usando el `Dockerfile` raíz.
- Ese artefacto web se sirve desde `nginx:alpine` usando `docker-compose.yml`.
- El workflow [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml) despliega esa web estática en el VPS `staging` bajo `/srv/handover-staging`.
- `config/staging.env` es la fuente de build args públicos para esa exportación.

Límite actual, explícito:

- El repo no define hoy un `docker-compose` full-stack para Django.
- El backend sigue siendo una pieza separada y su arranque documentado real es el comando del [`Procfile`](../Procfile).
- `config/nginx/handover.conf` es un template de reverse proxy hacia `127.0.0.1:8000`; no forma parte del contenedor web exportado.

## Topologías secundarias o residuales

- Backend Django manual o PaaS-compatible: residual pero vigente, usando `gunicorn` según [`Procfile`](../Procfile).
- Publicación a PyPI: desactivada de forma explícita. El repo no tiene `pyproject.toml`, `setup.py` ni `setup.cfg`, así que [`.github/workflows/python-publish.yml`](../.github/workflows/python-publish.yml) quedó como residual manual sin publicación real.
- Android e iOS: siguen siendo artefactos de release, no un deploy automatizado dentro de este repo.

## Validaciones previas mínimas

Antes de generar artefactos o desplegar en piloto:

```bash
git diff --check
pnpm -w typecheck
pnpm -w lint:ci
pnpm test
pnpm -w validate:fhir
pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
```

Si solo cambias frontend web y documentación operativa, `pytest` sigue recomendado pero deja de ser bloqueante solo si el backend no fue tocado.

Wrapper reproducible del repo:

```powershell
pwsh -File scripts/release-rehearsal.ps1 -Stage preflight
```

## Variables de entorno y frontera de secretos

### Web exportada con Docker Compose

`docker-compose.yml` consume build args desde `config/staging.env` para estos valores públicos o semipúblicos:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_FHIR_BASE_URL`
- `EXPO_PUBLIC_ALLOWED_UNITS`
- `EXPO_PUBLIC_ALLOW_ALL_UNITS`
- `EXPO_PUBLIC_BYPASS_SCOPE`
- `EXPO_PUBLIC_STORAGE_NAMESPACE`
- `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`
- `EXPO_PUBLIC_QUEUE_BACKOFF_BASE`
- `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE`
- `EXPO_PUBLIC_CLIENT_SIGNING_ENABLED`
- `EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE`
- `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE`
- `EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON`
- `EXPO_PUBLIC_HANDOVER_UNITS_JSON`
- `EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON`
- `EXPO_PUBLIC_SHOW_NIC_CODING`
- `EXPO_PUBLIC_SHOW_NOC_OUTCOMES`
- `EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS`
- `EXPO_PUBLIC_HIDE_LEGACY_FIELDS`
- `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`
- `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING`
- `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING`
- `EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK`
- `EXPO_PUBLIC_ENABLE_ICEA_CAUSAL_SUMMARY`
- `EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED`
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED`
- `EXPO_PUBLIC_ENABLE_DEMO`
- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_AUDIENCE`
- `OIDC_SCOPE`
- `OIDC_REDIRECT_SCHEME`

Regla operativa:

- `config/staging.env` no debe almacenar secretos backend, claves privadas ni tokens privilegiados.
- Los secretos de Django, firma, retención, DB y webhooks deben vivir fuera del repo en el entorno real del backend.
- `config/staging.env` debe declarar explícitamente el modo de despliegue y los defaults públicos críticos del piloto para que la exportación web no caiga por omisión a valores distintos del backend.

Inferencia desde [`src/config/pilotControl.ts`](../src/config/pilotControl.ts): si `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE=pilot` y `EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON` falta, el frontend cae a `rolloutStatus=pause` y `explicitShadowModeForIcea=true`; la ausencia del JSON no debe interpretarse como `go`.

### Backend Django

Variables críticas documentadas en [`.env.example`](../.env.example) y [`backend/.env.example`](../backend/.env.example):

- `HANDOVER_DEPLOYMENT_MODE`
- `HANDOVER_PILOT_CONTROL_JSON`
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_AUDIENCE`
- `HANDOVER_PRIVATE_KEY_PATH`
- `HANDOVER_PUBLIC_KEY_PATH`
- `HANDOVER_BUNDLE_ENCRYPTION_KEY`
- `HANDOVER_BUNDLE_RETENTION_DAYS`
- `HANDOVER_TECHNICAL_RETENTION_DAYS`
- `ICEA_WEBHOOK_*`
- `ENABLE_ICEA_BRIDGE` e `ICEA_BRIDGE_*`

Contrato operativo de auth para backend:

- fuera de tests reales, `DJANGO_DEBUG=true` solo es admisible con `HANDOVER_DEPLOYMENT_MODE=development|demo`;
- en `pilot`/`production` y en cualquier despliegue no local explícito, el backend debe arrancar con `DJANGO_DEBUG=false`;
- fuera de ese perímetro local explícito, `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE` son obligatorios y la ausencia de cualquiera de ambos debe abortar startup en fail-closed.

## Control de piloto y rollout seguro

El repo soporta un control plane minimo gobernado por entorno, no un panel mutable nuevo. La activacion efectiva del piloto depende de:

- `HANDOVER_DEPLOYMENT_MODE` en backend;
- `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE` en frontend web/app;
- `HANDOVER_PILOT_CONTROL_JSON` en backend;
- `EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON` en frontend.

Reglas de despliegue para piloto:

- no actives ICEA nominal por defecto; usa `explicitShadowModeForIcea=true` mientras el piloto siga en fase prudente;
- si `HANDOVER_PILOT_CONTROL_JSON` restringe unidades o roles, valida el resultado con `GET /api/pilot-control/summary` antes del `go`;
- si hay rollback, primero cambia el JSON de control y solo despues usa el kill switch duro (`ENABLE_ICEA_*`, `SHOW_*`, `AI_SUGGESTIONS_ENABLED`) si el corte debe ser inmediato;
- el flujo clinico base debe poder seguir con analytics/admin/insights apagados.

Ejemplo prudente de backend para piloto:

```env
HANDOVER_DEPLOYMENT_MODE=pilot
HANDOVER_PILOT_CONTROL_JSON={"pilotMode":"pilot","rolloutStatus":"pause","enabledUnits":["icu-a"],"allowedRoles":["nurse","supervisor","admin"],"environmentScope":["pilot"],"explicitShadowModeForIcea":true,"features":{"icea_bridge":{"mode":"shadow","enabledUnits":["icu-a"]},"icea_patient_risk":{"mode":"disabled"},"admin_analytics":{"mode":"shadow","allowedRoles":["supervisor","admin"]},"governed_nnn":{"mode":"pilot","enabledUnits":["icu-a"]}}}
```

Limitacion operativa explicita:

- el estado `go/pause/no-go` es consultable, pero la aprobacion y auditoria institucional del cambio siguen fuera del repo.

## Deploy web staging automatizado

El flujo automatizado real del repo es:

```bash
docker compose --env-file config/staging.env config
docker compose --env-file config/staging.env pull
docker compose --env-file config/staging.env up -d --build
```

Eso coincide con el workflow de staging, que ahora valida `docker compose ... config` antes del `up -d --build`.

Notas:

- El `Dockerfile` exporta la web con `pnpm expo export --platform web`.
- El contenedor final solo sirve archivos estáticos con nginx.
- Las variables de runtime del servicio `web` no se usan para reconfigurar la app ya exportada; la configuración efectiva entra en build time.

## Backend Django residual y explícito

El backend no tiene `Dockerfile` ni `docker-compose` propio en este repo. La vía documentada real sigue siendo:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r backend/requirements.txt
python manage.py migrate
gunicorn backend.wsgi --preload --bind 0.0.0.0:${PORT:-8000}
```

Ese comando es el mismo que declara el [`Procfile`](../Procfile). Si se usa nginx frontal, [`config/nginx/handover.conf`](../config/nginx/handover.conf) asume ese upstream en `127.0.0.1:8000`.

## Paquetes de compartición y release hygiene

- [`scripts/zip-project.ps1`](../scripts/zip-project.ps1) genera ahora ZIPs `lite` y `full` saneados.
- Ambos ZIPs excluyen secretos, bases locales, `.env.*` no-ejemplo, logs, `backups/`, `artifacts/`, `playwright-report/`, `test-results/` y artefactos runtime compartibles.
- [`.gitignore`](../.gitignore) y [`.dockerignore`](../.dockerignore) también excluyen `db.sqlite3`, variantes `*.sqlite3-*`, `backend/.env`, claves, media local, `backups/` y artefactos temporales de rehearsal.

Runbooks nuevos del repo:

- [`docs/backup-restore-drill.md`](./backup-restore-drill.md): backup cifrado por defecto, restore scratch-first y validación mínima reproducible.
- [`docs/release-rehearsal.md`](./release-rehearsal.md): preflight, smoke post-deploy, criterios de aborto, rollback básico y evidencia mínima del piloto. El stage `perf` usa una SQLite efímera local por defecto y no debe apuntar a una BD viva salvo override peligroso explícito.

## Política simple de release piloto

- La fuente de verdad del identificador de release piloto es el tag Git más [`RELEASE_NOTES.md`](../RELEASE_NOTES.md).
- `package.json` y `app.config.ts` conservan hoy `1.0.0` como versión de build local; no los trates como mecanismo automático de versionado de release.
- No declares “deploy listo” para full stack mientras el backend siga fuera de `docker-compose.yml`.
- No reactives publicación a PyPI hasta que exista un contrato de paquete Python real en el repo.
- El ensayo de release/piloto del repo es `scratch-first`: valida build, smoke, backup/restore y empaquetado; no sustituye rollback full-stack automatizado del backend porque esa topología no existe en este árbol.
- Los backups con `BACKUP_REQUIRE_ENCRYPTION=true` ahora fallan cerrado: si falta passphrase o falla el cifrado, no debe quedar un artefacto persistente en claro en `BACKUP_DIR`.
