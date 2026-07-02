#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${PG_CONTAINER:-telegram-postgres-1}"
DB="${PG_DATABASE:-localizer}"
USER="${PG_USER:-postgres}"

run_sql() {
  local sql="$1"
  ssh ai-pipeline "docker exec $CONTAINER psql -U $USER -d $DB -c \"$sql\""
}

echo "=== Active sessions on $DB ==="
run_sql "SELECT pid, usename, state, wait_event_type, left(query, 80) AS query FROM pg_stat_activity WHERE datname = 'localizer' ORDER BY pid;"

echo ""
echo "=== Terminating all other sessions ==="
run_sql "SELECT pg_terminate_backend(pid) AS terminated, pid FROM pg_stat_activity WHERE datname = 'localizer' AND pid <> pg_backend_pid();"

echo ""
echo "=== Remaining sessions ==="
run_sql "SELECT count(*) AS remaining FROM pg_stat_activity WHERE datname = 'localizer';"
