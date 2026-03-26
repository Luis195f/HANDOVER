#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

log() {
  printf '[restore-media] %s\n' "$*"
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
  log "Usage: scripts/restore-media.sh <backup-file>"
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

target_dir=${RESTORE_MEDIA_DIR:-${MEDIA_DIR:-uploads}}
if [[ -d "$target_dir" ]] && find "$target_dir" -mindepth 1 -print -quit | grep -q .; then
  log "Target media directory $target_dir is not empty; restore into a scratch path for the drill"
  exit 1
fi

mkdir -p "$target_dir"
require_command tar
log "Extracting archive into $target_dir"
tar -xzf "$current_path" -C "$target_dir"

file_count=$(find "$target_dir" -type f | wc -l | tr -d ' ')
if [[ "${file_count:-0}" == "0" ]]; then
  log "Restore produced no files in $target_dir"
  exit 1
fi

log "Restore complete ($file_count files)"
