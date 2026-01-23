#!/usr/bin/env bash
# ── restore.sh ───────────────────────────────────────────────────────────────
# Restores a localizer database from a .sql.gz backup created by backup.sh.
# Works both locally (with psql installed) and via Docker Compose.
#
# Usage:
#   ./scripts/restore.sh <backup_file>              # auto-detect mode
#   ./scripts/restore.sh --docker <backup_file>      # force Docker Compose mode
#   ./scripts/restore.sh --local  <backup_file>      # force local psql
#
# WARNING: This drops and recreates the target database!
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  set -a; source .env; set +a
fi

DB_USER="${POSTGRES_USER:-localizer}"
DB_NAME="${POSTGRES_DB:-localizer}"

# Parse arguments
MODE="auto"
BACKUP_FILE=""

for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --local)  MODE="local" ;;
    *)        BACKUP_FILE="$arg" ;;
  esac
done

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 [--docker|--local] <backup_file.sql.gz>" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "⚠  This will DROP and recreate the '$DB_NAME' database."
read -rp "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

restore_docker() {
  echo "Restoring via Docker Compose..."
  # Drop and recreate database
  docker compose exec -T db psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $DB_NAME;" \
    -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  # Restore from gzipped dump
  gunzip -c "$BACKUP_FILE" | docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" --quiet
}

restore_local() {
  echo "Restoring via local psql..."
  psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $DB_NAME;" \
    -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  gunzip -c "$BACKUP_FILE" | psql -U "$DB_USER" -d "$DB_NAME" --quiet
}

case "$MODE" in
  docker) restore_docker ;;
  local)  restore_local ;;
  auto)
    if docker compose ps --services --filter status=running 2>/dev/null | grep -q '^db$'; then
      restore_docker
    else
      restore_local
    fi
    ;;
esac

echo "Database '$DB_NAME' restored from: $BACKUP_FILE"
