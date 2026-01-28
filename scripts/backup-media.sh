#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

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

timestamp=$(date -u +%Y%m%d_%H%M%S)
retention_days=${BACKUP_RETENTION_DAYS:-7}
backup_root=${BACKUP_DIR:-backups/media}
media_dir=${MEDIA_DIR:-uploads}
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
  gpg --batch --yes --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
    --symmetric --cipher-algo AES256 \
    --output "$encrypted_path" "$archive_path"
  rm -f "$archive_path"
  upload_path="$encrypted_path"
fi

remote_base=${BACKUP_REMOTE:-remote:handover-backups}
remote_path="${remote_base%/}/media"
require_command rclone
log "Uploading $upload_path to $remote_path"
rclone copy "$upload_path" "$remote_path"

log "Pruning local backups older than ${retention_days} days"
find "$backup_root" -type f -name 'media_*' -mtime "+${retention_days}" -print -delete

log "Pruning remote backups older than ${retention_days} days"
rclone delete --min-age "${retention_days}d" "$remote_path"

log "Backup complete"
