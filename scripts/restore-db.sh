#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

log() {
  printf '[restore-db] %s\n' "$*"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "Missing required command: $cmd"
    exit 1
  fi
}

verify_checksum() {
  local checksum_path="$1"
  if [[ ! -f "$checksum_path" ]]; then
    return 0
  fi
  local checksum_dir
  checksum_dir=$(cd "$(dirname "$checksum_path")" && pwd)
  local checksum_file
  checksum_file=$(basename "$checksum_path")
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$checksum_dir" && sha256sum -c "$checksum_file")
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    (cd "$checksum_dir" && shasum -a 256 -c "$checksum_file")
    return
  fi
  log "Missing required command: sha256sum or shasum"
  exit 1
}

decrypt_file() {
  local source_path="$1"
  local output_path="$2"
  local passphrase="$3"
  printf '%s' "$passphrase" | gpg \
    --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$output_path" "$source_path"
}

source_path=${1:-${RESTORE_BACKUP_FILE:-}}
if [[ -z "$source_path" ]]; then
  log "Usage: scripts/restore-db.sh <backup-file>"
  exit 1
fi
if [[ "$source_path" == *.sha256 ]]; then
  log "Pass the backup artifact, not the checksum file"
  exit 1
fi
if [[ ! -f "$source_path" ]]; then
  log "Backup file not found at $source_path"
  exit 1
fi

checksum_path=${RESTORE_CHECKSUM_FILE:-}
if [[ -z "$checksum_path" && -f "${source_path}.sha256" ]]; then
  checksum_path="${source_path}.sha256"
fi
if [[ -n "$checksum_path" ]]; then
  log "Verifying checksum from $checksum_path"
  verify_checksum "$checksum_path"
fi

work_root=${RESTORE_WORK_DIR:-}
cleanup_work_root=false
if [[ -z "$work_root" ]]; then
  work_root=$(mktemp -d)
  cleanup_work_root=true
else
  mkdir -p "$work_root"
fi

cleanup() {
  if [[ "$cleanup_work_root" == "true" ]]; then
    rm -rf "$work_root"
  else
    log "Preserving work directory at $work_root"
  fi
}
trap cleanup EXIT

current_path="$source_path"
passphrase=${RESTORE_ENCRYPTION_PASSPHRASE:-${BACKUP_ENCRYPTION_PASSPHRASE:-}}

if [[ "$current_path" == *.gpg ]]; then
  require_command gpg
  if [[ -z "$passphrase" ]]; then
    log "RESTORE_ENCRYPTION_PASSPHRASE or BACKUP_ENCRYPTION_PASSPHRASE is required for encrypted backups"
    exit 1
  fi
  decrypted_path="$work_root/$(basename "${current_path%.gpg}")"
  log "Decrypting archive to $decrypted_path"
  decrypt_file "$current_path" "$decrypted_path" "$passphrase"
  current_path="$decrypted_path"
fi

if [[ "$current_path" == *.gz ]]; then
  payload_path="$work_root/$(basename "${current_path%.gz}")"
  log "Decompressing archive to $payload_path"
  gzip -cd "$current_path" > "$payload_path"
  current_path="$payload_path"
fi

restore_engine=${RESTORE_DB_ENGINE:-${DJANGO_DB_ENGINE:-}}
if [[ -z "$restore_engine" ]]; then
  case "$current_path" in
    *.sql) restore_engine="django.db.backends.postgresql" ;;
    *) restore_engine="django.db.backends.sqlite3" ;;
  esac
fi

validate_restore=${RESTORE_VALIDATE:-true}

if [[ "$restore_engine" == *"sqlite"* ]]; then
  target_path=${RESTORE_DB_TARGET:-${DJANGO_DB_NAME:-db.sqlite3}}
  if [[ -e "$target_path" ]]; then
    log "Target SQLite path already exists at $target_path; use a scratch path for the drill"
    exit 1
  fi
  mkdir -p "$(dirname "$target_path")"
  cp "$current_path" "$target_path"
  log "Restored SQLite backup to $target_path"
  if [[ "$validate_restore" == "true" ]]; then
    require_command sqlite3
    integrity=$(sqlite3 "$target_path" 'PRAGMA integrity_check;')
    if [[ "$integrity" != "ok" ]]; then
      log "SQLite integrity check failed: $integrity"
      exit 1
    fi
    migration_table=$(sqlite3 "$target_path" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='django_migrations';")
    if [[ "$migration_table" != "1" ]]; then
      log "django_migrations table is missing in restored SQLite database"
      exit 1
    fi
    log "SQLite integrity and schema checks passed"
  fi
else
  require_command psql
  db_name=${RESTORE_DB_NAME:-${DJANGO_DB_NAME:-}}
  if [[ -z "$db_name" ]]; then
    log "RESTORE_DB_NAME or DJANGO_DB_NAME is required for PostgreSQL restore"
    exit 1
  fi
  expect_empty=${RESTORE_POSTGRES_EXPECT_EMPTY:-true}
  psql_args=(-v ON_ERROR_STOP=1)
  if [[ -n "${DJANGO_DB_USER:-${DB_USER:-}}" ]]; then
    psql_args+=(-U "${DJANGO_DB_USER:-${DB_USER:-}}")
  fi
  if [[ -n "${DJANGO_DB_HOST:-${DB_HOST:-}}" ]]; then
    psql_args+=(-h "${DJANGO_DB_HOST:-${DB_HOST:-}}")
  fi
  if [[ -n "${DJANGO_DB_PORT:-${DB_PORT:-}}" ]]; then
    psql_args+=(-p "${DJANGO_DB_PORT:-${DB_PORT:-}}")
  fi
  export PGPASSWORD=${DJANGO_DB_PASSWORD:-${DB_PASSWORD:-${PGPASSWORD:-}}}
  if [[ "$expect_empty" == "true" ]]; then
    existing_tables=$(psql "${psql_args[@]}" -d "$db_name" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
    if [[ "${existing_tables:-0}" != "0" ]]; then
      log "PostgreSQL target database $db_name is not empty; restore into a scratch database for the drill"
      exit 1
    fi
  fi
  log "Importing SQL into PostgreSQL database $db_name"
  psql "${psql_args[@]}" -d "$db_name" -f "$current_path"
  if [[ "$validate_restore" == "true" ]]; then
    migration_count=$(psql "${psql_args[@]}" -d "$db_name" -Atc "SELECT COUNT(*) FROM django_migrations;")
    if [[ -z "${migration_count:-}" ]]; then
      log "django_migrations validation failed on PostgreSQL restore"
      exit 1
    fi
    log "PostgreSQL restore validation passed (django_migrations rows: $migration_count)"
  fi
fi

log "Restore complete"
