# shellcheck shell=bash
# Resolve DB_USER / DB_NAME from DATABASE_URL when set.
# Usage: source scripts/_db_from_url.sh

DB_USER="${DB_USER:-localizer}"
DB_NAME="${DB_NAME:-localizer}"

if [ -n "${DATABASE_URL:-}" ]; then
  _db_url="${DATABASE_URL#*://}"
  _db_userpass="${_db_url%%@*}"
  _db_rest="${_db_url#*@}"
  _db_path="${_db_rest#*/}"

  DB_USER="${_db_userpass%%:*}"
  DB_NAME="${_db_path%%\?*}"
fi
