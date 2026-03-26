#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

log() {
  printf '[backup-media] %s\n' "$*"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "Missing required command: $cmd"
    exit 1
  fi
}

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

sha256_digest() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return
  fi
  log "Missing required command: sha256sum or shasum"
  exit 1
}

encrypt_file() {
  local source_path="$1"
  local output_path="$2"
  local passphrase="$3"
  printf '%s' "$passphrase" | gpg \
    --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 \
    --output "$output_path" "$source_path"
}

timestamp=$(date -u +%Y%m%d_%H%M%S)
retention_days=${BACKUP_RETENTION_DAYS:-7}
backup_root=${BACKUP_DIR:-backups/media}
media_dir=${MEDIA_DIR:-uploads}
skip_remote=${BACKUP_SKIP_REMOTE:-false}
require_encryption=${BACKUP_REQUIRE_ENCRYPTION:-true}
mkdir -p "$backup_root"

if [[ ! -d "$media_dir" ]]; then
  log "Media directory not found at $media_dir"
  exit 1
fi

archive_path="$backup_root/media_${timestamp}.tar.gz"
log "Archiving media from $media_dir to $archive_path"
tar -czf "$archive_path" -C "$media_dir" .

upload_path="$archive_path"
if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  require_command gpg
  encrypted_path="${archive_path}.gpg"
  log "Encrypting archive to $encrypted_path"
  encrypt_file "$archive_path" "$encrypted_path" "$BACKUP_ENCRYPTION_PASSPHRASE"
  rm -f "$archive_path"
  upload_path="$encrypted_path"
elif is_true "$require_encryption"; then
  log "BACKUP_ENCRYPTION_PASSPHRASE is required unless BACKUP_REQUIRE_ENCRYPTION=false is set explicitly"
  exit 1
else
  log "Encryption disabled by explicit override (BACKUP_REQUIRE_ENCRYPTION=false)"
fi

checksum_path="${upload_path}.sha256"
printf '%s  %s\n' "$(sha256_digest "$upload_path")" "$(basename "$upload_path")" > "$checksum_path"
log "Wrote checksum $checksum_path"

if is_true "$skip_remote"; then
  log "Skipping remote upload because BACKUP_SKIP_REMOTE=true"
else
  remote_base=${BACKUP_REMOTE:-remote:handover-backups}
  remote_path="${remote_base%/}/media"
  require_command rclone
  log "Uploading $upload_path to $remote_path"
  rclone copy "$upload_path" "$remote_path"
  rclone copy "$checksum_path" "$remote_path"

  log "Pruning remote backups older than ${retention_days} days"
  rclone delete --min-age "${retention_days}d" "$remote_path"
fi

log "Pruning local backups older than ${retention_days} days"
find "$backup_root" -type f -name 'media_*' -mtime "+${retention_days}" -print -delete

log "Backup complete"
