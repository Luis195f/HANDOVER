# Release rehearsal

> Estado del documento
> - Estado: `pilot`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: `scripts/release-rehearsal.ps1`, `scripts/perf-smoke.py`, `scripts/zip-project.ps1`, `docs/DEPLOY.md`, `docs/backup-restore-drill.md`, `.github/workflows/deploy-staging.yml`.
> - Límite abierto: el repo automatiza la web estática de staging, pero no un deploy/rollback full-stack del backend Django.

## 1) Objetivo

Dejar un ensayo de release/piloto utilizable, abortable y reversible sobre el estado real del repo:

- HANDOVER sigue siendo la capa operativa principal.
- ICEA+ sigue en postura prudente y no nominal.
- El ensayo valida preflight, smoke, backup/restore y empaquetado sin prometer más topología de la que existe.

## 2) Preflight reproducible

```powershell
pwsh -File scripts/release-rehearsal.ps1 -Stage preflight
```

Eso ejecuta:

- `git diff --check`
- `pnpm -w typecheck`
- `pnpm -w lint:ci`
- `pnpm test`
- `pnpm -w validate:fhir`
- `pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests`
- `docker compose --env-file config/staging.env config`

Si el seam no toca backend, el operador puede usar `-SkipPytest`, pero debe dejar esa decisión explícita en la evidencia.

## 3) Performance mínima

Medición sintética local:

```bash
python scripts/perf-smoke.py --iterations 5
```

Por defecto, `scripts/perf-smoke.py` ignora cualquier `DJANGO_DB_*` del entorno y fuerza una SQLite efímera local bajo `tmp/` para no tocar staging/prod por accidente. Solo usa una BD no efímera si el operador habilita deliberadamente `PERF_SMOKE_ALLOW_NON_EPHEMERAL_DB=true`, y el script lo deja explícito en salida.

Smoke reproducible de queue/sync:

```bash
pnpm exec vitest run tests/queue/offline-queue.spec.ts src/lib/__tests__/sync.offline.spec.ts
```

Limitación:

- el smoke sintético mide la ruta local Django con upstream simulado y agregados locales;
- por defecto trabaja solo sobre datos sintéticos y una DB efímera local;
- el override `PERF_SMOKE_ALLOW_NON_EPHEMERAL_DB=true` es deliberado y peligroso;
- no sustituye percentiles E2E con navegador, red, backend real y upstream ICEA/FHIR reales.

## 4) Backup/restore antes del go

Antes de declarar un rehearsal satisfactorio, ejecutar o adjuntar el drill de [`docs/backup-restore-drill.md`](./backup-restore-drill.md).

Mínimo aceptable:

- un backup DB cifrado;
- un restore DB a scratch validado;
- si aplica media/adjuntos en el piloto, backup y restore scratch de media.

## 5) Empaquetado compartible

```powershell
pwsh -File scripts/release-rehearsal.ps1 -Stage package
```

Los ZIPs resultantes excluyen secretos, DB/media locales y artefactos runtime compartibles.

## 6) Smoke post-deploy

Smoke mínimo de la web estática:

```powershell
pwsh -File scripts/release-rehearsal.ps1 -Stage postdeploy -BaseUrl https://staging.example.com
```

Smoke autenticado opcional del control plane:

```powershell
pwsh -File scripts/release-rehearsal.ps1 -Stage postdeploy `
  -BaseUrl https://staging.example.com `
  -PilotControlUrl "https://staging.example.com/api/pilot-control/summary?unitId=icu-adulto&role=supervisor" `
  -BearerToken $env:PILOT_CONTROL_BEARER
```

## 7) Criterios explícitos de aborto

- falla cualquier paso de preflight;
- `docker compose --env-file config/staging.env config` no resuelve;
- el smoke de `BaseUrl` devuelve `>=400`;
- `GET /api/pilot-control/summary` no refleja el scope esperado;
- el drill de backup/restore falla o queda sin verificación;
- el smoke sintético/perf muestra errores nuevos no explicados.

## 8) Rollback básico

Rollback inmediato de riesgo clínico/analítico:

1. pasar el control plane a `pause` o `no-go`;
2. si hace falta corte duro, apagar `ENABLE_ICEA_*`, `SHOW_*` o `AI_SUGGESTIONS_ENABLED`;
3. revalidar `GET /api/pilot-control/summary`.

Rollback de la web estática en staging:

1. volver al commit o tag piloto previamente verificado en el host de staging;
2. ejecutar `docker compose --env-file config/staging.env up -d --build`;
3. repetir el smoke post-deploy.

Límite honesto:

- el backend Django no tiene rollback full-stack automatizado en este repo; esa parte sigue dependiendo del runbook del host/servicio fuera del árbol.

## 9) Evidencia mínima a adjuntar

- salida del preflight o `pwsh -File scripts/release-rehearsal.ps1 -Stage preflight`;
- salida de `python scripts/perf-smoke.py --iterations 5`;
- evidencia del drill de [`docs/backup-restore-drill.md`](./backup-restore-drill.md);
- nombres/checksums de ZIP si hubo compartición;
- resultado del smoke post-deploy;
- referencia al commit/tag evaluado y decisión `go/pause/no-go`.
