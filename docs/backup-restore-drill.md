# Backup y restore drill

> Estado del documento
> - Estado: `pilot`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: `scripts/backup-db.sh`, `scripts/backup-media.sh`, `scripts/restore-db.sh`, `scripts/restore-media.sh`, `.github/workflows/backup.yml`, `.gitignore`, `.dockerignore`.
> - Límite abierto: el repo cubre backup cifrado y restore `scratch-first`; no automatiza snapshots infra, vault ni rollback full-stack del backend.

## 1) Qué se respalda

- Base de datos Django:
  - SQLite: snapshot `backup_<timestamp>.sqlite3.gz` y, si hay passphrase, `backup_<timestamp>.sqlite3.gz.gpg`.
  - PostgreSQL: dump `backup_<timestamp>.sql.gz` y, si hay passphrase, `backup_<timestamp>.sql.gz.gpg`.
- Media o adjuntos locales: `media_<timestamp>.tar.gz` y, si hay passphrase, `media_<timestamp>.tar.gz.gpg`.
- Checksum `*.sha256` del artefacto final.

## 2) Qué NO se respalda

- `.env`, `backend/.env`, secretos OIDC/Auth0, claves privadas, `RCLONE_CONFIG_BASE64` ni credenciales del proveedor de backup.
- `node_modules/`, `coverage/`, `playwright-report/`, `test-results/`, `artifacts/`, `backups/` previos ya saneados, `db.sqlite3` versionado por error y media local fuera del `MEDIA_DIR` configurado.
- Estado operativo del host del backend, nginx, systemd, cron u otros servicios fuera de este repo.

## 3) Defaults y prerequisitos

- `BACKUP_ENCRYPTION_PASSPHRASE` es obligatoria por defecto.
- Si falta y `BACKUP_REQUIRE_ENCRYPTION=true`, `scripts/backup-db.sh` y `scripts/backup-media.sh` fallan cerrado antes de dejar `*.gz` o `*.tar.gz` persistentes en claro.
- Si se necesita desactivar cifrado, usar solo el override explícito `BACKUP_REQUIRE_ENCRYPTION=false`.
- Para drill local sin remoto, usar `BACKUP_SKIP_REMOTE=true`.
- Dependencias:
  - DB: `sqlite3` o `pg_dump`/`psql` según motor.
  - Media: `tar`.
  - Cifrado: `gpg`.
  - Remoto: `rclone` solo si no se usa `BACKUP_SKIP_REMOTE=true`.

## 4) Drill local reproducible

### Backup DB a carpeta local

```bash
BACKUP_SKIP_REMOTE=true \
BACKUP_DIR=backups/drill \
BACKUP_ENCRYPTION_PASSPHRASE='replace-with-drill-passphrase' \
bash scripts/backup-db.sh
```

### Backup media a carpeta local

```bash
BACKUP_SKIP_REMOTE=true \
BACKUP_DIR=backups/drill \
MEDIA_DIR=uploads \
BACKUP_ENCRYPTION_PASSPHRASE='replace-with-drill-passphrase' \
bash scripts/backup-media.sh
```

### Restore DB a ruta scratch

SQLite:

```bash
RESTORE_ENCRYPTION_PASSPHRASE='replace-with-drill-passphrase' \
RESTORE_DB_TARGET=tmp/restore/db.sqlite3 \
bash scripts/restore-db.sh backups/drill/backup_<timestamp>.sqlite3.gz.gpg
```

PostgreSQL scratch:

```bash
createdb handover_restore_drill
RESTORE_ENCRYPTION_PASSPHRASE='replace-with-drill-passphrase' \
RESTORE_DB_NAME=handover_restore_drill \
bash scripts/restore-db.sh backups/drill/backup_<timestamp>.sql.gz.gpg
```

### Restore media a ruta scratch

```bash
RESTORE_ENCRYPTION_PASSPHRASE='replace-with-drill-passphrase' \
RESTORE_MEDIA_DIR=tmp/restore/uploads \
bash scripts/restore-media.sh backups/drill/media_<timestamp>.tar.gz.gpg
```

## 5) Verificación mínima posterior al restore

- SQLite scratch:
  ```bash
  sqlite3 tmp/restore/db.sqlite3 'PRAGMA integrity_check;'
  DJANGO_DB_ENGINE=django.db.backends.sqlite3 DJANGO_DB_NAME=tmp/restore/db.sqlite3 python manage.py check
  ```
- PostgreSQL scratch:
  ```bash
  psql -d handover_restore_drill -Atc 'SELECT COUNT(*) FROM django_migrations;'
  DJANGO_DB_ENGINE=django.db.backends.postgresql DJANGO_DB_NAME=handover_restore_drill python manage.py check
  ```
- Media scratch:
  ```bash
  find tmp/restore/uploads -type f | wc -l
  ```

## 6) Reglas de seguridad operativa

- No guardar la passphrase de backup en `config/staging.env`, `.env.example` ni ZIPs compartidos.
- No promover automáticamente el scratch restore sobre la DB/media viva; la promoción final queda fuera del repo y debe ser deliberada.
- No usar el override `BACKUP_REQUIRE_ENCRYPTION=false` salvo drill controlado y sin PHI real.
- Los scripts de backup usan temporales con cleanup; si el cifrado requerido falla o falta passphrase, no deben quedar dumps/archives huérfanos en claro en `BACKUP_DIR`.

## 7) Límites honestos

- El workflow nocturno de GitHub Actions demuestra ejecución de backup, no un restore de infraestructura extremo a extremo.
- El repo no demuestra inmutabilidad del almacenamiento remoto, borrado seguro del proveedor ni restauración del host/backend completo.
- El restore por defecto es conservador: falla si la ruta scratch ya existe o si la base PostgreSQL destino no está vacía.
