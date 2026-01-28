#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

log() {
  printf '[backup-db] %s\n' "$*"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "Missing required command: $cmd"
    exit 1
  fi
}

timestamp=$(date -u +%Y%m%d_%H%M%S)
retention_days=${BACKUP_RETENTION_DAYS:-7}
backup_root=${BACKUP_DIR:-backups/db}
mkdir -p "$backup_root"

engine=${DJANGO_DB_ENGINE:-django.db.backends.sqlite3}
name=${DJANGO_DB_NAME:-db.sqlite3}

backup_path=""
if [[ "$engine" == *"sqlite"* ]]; then
  backup_path="$backup_root/backup_${timestamp}.sqlite3"
  if [[ ! -f "$name" ]]; then
    log "SQLite database not found at $name"
    exit 1
  fi
  if command -v sqlite3 >/dev/null 2>&1; then
    log "Creating SQLite backup via sqlite3 .backup"
    sqlite3 "$name" ".backup '$backup_path'"
  else
    log "sqlite3 not available; copying database file"
    cp "$name" "$backup_path"
  fi
elif [[ "$engine" == *"postgres"* ]]; then
  require_command pg_dump
  backup_path="$backup_root/backup_${timestamp}.sql"
  pg_user=${DJANGO_DB_USER:-${DB_USER:-}}
  pg_host=${DJANGO_DB_HOST:-${DB_HOST:-}}
  pg_port=${DJANGO_DB_PORT:-${DB_PORT:-}}
  export PGPASSWORD=${DJANGO_DB_PASSWORD:-${DB_PASSWORD:-${PGPASSWORD:-}}}

  log "Creating PostgreSQL dump"
  dump_args=()
  if [[ -n "${pg_user}" ]]; then
    dump_args+=("-U" "$pg_user")
  fi
  if [[ -n "${pg_host}" ]]; then
    dump_args+=("-h" "$pg_host")
  fi
  if [[ -n "${pg_port}" ]]; then
    dump_args+=("-p" "$pg_port")
  fi
  pg_dump "${dump_args[@]}" "$name" > "$backup_path"
else
  log "Unsupported DJANGO_DB_ENGINE: $engine"
  exit 1
fi

archive_path="${backup_path}.gz"
log "Compressing backup to $archive_path"
gzip -c "$backup_path" > "$archive_path"
rm -f "$backup_path"

upload_path="$archive_path"
if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  require_command gpg
  encrypted_path="${archive_path}.gpg"
  log "Encrypting backup to $encrypted_path"
  gpg --batch --yes --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --symmetric --cipher-algo AES256 \
    --output "$encrypted_path" "$archive_path"
  rm -f "$archive_path"
  upload_path="$encrypted_path"
fi

remote_base=${BACKUP_REMOTE:-remote:handover-backups}
remote_path="${remote_base%/}/db"
require_command rclone
log "Uploading $upload_path to $remote_path"
rclone copy "$upload_path" "$remote_path"

log "Pruning local backups older than ${retention_days} days"
find "$backup_root" -type f -name 'backup_*' -mtime "+${retention_days}" -print -delete

log "Pruning remote backups older than ${retention_days} days"
rclone delete --min-age "${retention_days}d" "$remote_path"

log "Backup complete"
