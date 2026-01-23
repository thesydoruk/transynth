#!/usr/bin/env bash
# ── backup.sh ────────────────────────────────────────────────────────────────
# Creates a timestamped pg_dump backup of the localizer database.
# Works both locally (with psql installed) and via Docker Compose.
#
# Usage:
#   ./scripts/backup.sh                   # auto-detect: Docker if running, else local
#   ./scripts/backup.sh --docker          # force Docker Compose mode
#   ./scripts/backup.sh --local           # force local pg_dump
#
# Output: ./data/backups/localizer_YYYYMMDD_HHMMSS.sql.gz
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="./data/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/localizer_${TIMESTAMP}.sql.gz"

# Load .env if present (for POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB)
if [ -f .env ]; then
  set -a; source .env; set +a
fi

DB_USER="${POSTGRES_USER:-localizer}"
DB_NAME="${POSTGRES_DB:-localizer}"

mkdir -p "$BACKUP_DIR"

# Determine mode: --docker, --local, or auto-detect
MODE="${1:-auto}"

use_docker() {
  echo "Backing up via Docker Compose..."
  docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"
}

use_local() {
  echo "Backing up via local pg_dump..."
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"
}

case "$MODE" in
  --docker) use_docker ;;
  --local)  use_local ;;
  auto)
    if docker compose ps --services --filter status=running 2>/dev/null | grep -q '^db$'; then
      use_docker
    else
      use_local
    fi
    ;;
  *)
    echo "Usage: $0 [--docker|--local]" >&2
    exit 1
    ;;
esac

echo "Backup saved to: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
