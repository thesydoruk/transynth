#!/usr/bin/env bash
# ── deploy.sh ────────────────────────────────────────────────────────────────
# Pull-based deployment. Runs on the production host, from a git checkout of
# this repo, usually every few minutes from a systemd timer
# (docker/systemd/transynth-deploy.timer). Nothing reaches into the host from
# outside: CI publishes images, this script pulls them.
#
# For every green commit on main, CI pushes $TRANSYNTH_IMAGE:<full sha>. A run:
#   1. fetches origin/$DEPLOY_BRANCH; stops if that commit is already deployed
#      (IMAGE_TAG in .env) or its image is not published yet
#   2. checks the commit out and, if sql/ changed, backs up the database
#   3. pulls images and applies the schema (npm run db:init)
#   4. recreates the services and waits for web to report healthy
#   5. on failure: puts the previous commit and image back and remembers the
#      failed commit, so the timer does not retry it every tick
#
# The schema is not rolled back — migrations in sql/schema.sql must keep the
# previous release working.
#
# Usage:
#   scripts/deploy.sh               # deploy origin/$DEPLOY_BRANCH if it is new
#   scripts/deploy.sh <commit>      # deploy that commit (e.g. roll back)
#   scripts/deploy.sh --force [...] # redeploy / retry a commit that failed
#
# Settings, read from .env:
#   TRANSYNTH_IMAGE     required, e.g. ghcr.io/thesydoruk/transynth
#   DEPLOY_BRANCH       default main
#   DEPLOY_BACKUP       schema (default: only when sql/ changed) | always | never
#   DEPLOY_BACKUP_CONTAINER  Postgres container outside this Compose project to
#                       dump from (scripts/backup.sh --container); default:
#                       backup.sh auto-detect
#   DEPLOY_HEALTH_TIMEOUT  seconds to wait for web to turn healthy, default 300
# ──────────────────────────────────────────────────────────────────────────────

# Everything runs inside main(): bash reads a script lazily, and step 2
# rewrites this very file on disk.
main() {
  set -euo pipefail
  cd "$(dirname "$0")/.."

  local force=0 target_ref=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=1 ;;
      -h | --help)
        sed -n '2,/^# ──────/p' "$0" | sed 's/^# \{0,1\}//'
        return 0
        ;;
      -*) die "unknown option: $1" ;;
      *) target_ref="$1" ;;
    esac
    shift
  done

  [ -f .env ] || die ".env not found in $PWD"

  exec 9> .git/transynth-deploy.lock
  if ! flock -n 9; then
    log 'another deploy is running'
    return 0
  fi

  local image branch backup_mode backup_container health_timeout
  image="$(env_get TRANSYNTH_IMAGE)"
  branch="$(env_get DEPLOY_BRANCH)"
  branch="${branch:-main}"
  backup_mode="$(env_get DEPLOY_BACKUP)"
  backup_mode="${backup_mode:-schema}"
  backup_container="$(env_get DEPLOY_BACKUP_CONTAINER)"
  health_timeout="$(env_get DEPLOY_HEALTH_TIMEOUT)"
  health_timeout="${health_timeout:-300}"
  [ -n "$image" ] || die 'TRANSYNTH_IMAGE is not set in .env'
  case "$backup_mode" in
    schema | always | never) ;;
    *) die "DEPLOY_BACKUP must be schema, always or never (got $backup_mode)" ;;
  esac

  git fetch --quiet origin "$branch"
  local target
  target="$(git rev-parse --verify "${target_ref:-origin/$branch}^{commit}")"

  local current_tag current_head
  current_tag="$(env_get IMAGE_TAG)"
  current_head="$(git rev-parse HEAD)"

  if [ "$force" = 0 ]; then
    if [ "$target" = "$current_tag" ]; then
      return 0
    fi
    if [ "$target" = "$(cat .git/transynth-deploy-failed 2>/dev/null)" ]; then
      return 0
    fi
  fi

  if ! docker manifest inspect "$image:$target" > /dev/null 2>&1; then
    log "waiting for CI to publish $image:$target"
    return 0
  fi

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    die 'tracked files are modified on the host; refusing to check out over them'
  fi

  log "deploying $(git log -1 --format='%h %s' "$target")"
  log "previous: ${current_tag:-<none>} (checkout $(git rev-parse --short HEAD))"

  rollback() {
    log "rolling back to checkout $current_head, image tag ${current_tag:-<default>}"
    git checkout --quiet --detach "$current_head"
    env_set IMAGE_TAG "$current_tag"
    if [ "${1:-}" = restart ]; then
      docker compose up -d --wait --wait-timeout "$health_timeout" || true
    fi
    echo "$target" > .git/transynth-deploy-failed
  }

  git checkout --quiet --detach "$target"

  local need_backup=0
  case "$backup_mode" in
    always) need_backup=1 ;;
    never) ;;
    schema)
      if ! git cat-file -e "$current_tag^{commit}" 2> /dev/null \
        || ! git diff --quiet "$current_tag" "$target" -- sql/; then
        need_backup=1
      fi
      ;;
  esac
  if [ "$need_backup" = 1 ]; then
    local backup_file
    backup_file="./data/backups/transynth_pre_$(git rev-parse --short "$target")_$(date +%Y%m%d_%H%M%S).sql.gz"
    log "backing up the database to $backup_file"
    if ! BACKUP_FILE="$backup_file" bash scripts/backup.sh \
      ${backup_container:+--container "$backup_container"}; then
      rollback
      die 'database backup failed; nothing was changed'
    fi
  fi

  env_set IMAGE_TAG "$target"

  if ! docker compose pull --quiet; then
    rollback
    die 'image pull failed; nothing was changed'
  fi

  log 'applying schema (npm run db:init)'
  if ! docker compose run --rm web npm run db:init; then
    rollback
    die 'db:init failed; services were not restarted'
  fi

  docker compose up -d
  if ! wait_healthy web "$health_timeout"; then
    docker compose logs --tail 80 web >&2 || true
    rollback restart
    die "web did not become healthy within ${health_timeout}s"
  fi
  if ! docker compose ps --status running --services | grep -qx worker; then
    docker compose logs --tail 80 worker >&2 || true
    rollback restart
    die 'worker is not running'
  fi

  rm -f .git/transynth-deploy-failed
  prune_images "$image" "$target" "$current_tag"
  log "deployed $target"
}

log() { echo "[deploy] $*"; }
die() {
  echo "[deploy] ERROR: $*" >&2
  exit 1
}

# Last KEY=value line of .env, surrounding quotes removed.
env_get() {
  local line
  line="$(grep -E "^$1=" .env | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

# Rewrite KEY in .env in place (removing it when VALUE is empty).
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp .env.deploy.XXXXXX)"
  grep -vE "^$key=" .env > "$tmp" || true
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  chmod --reference=.env "$tmp"
  mv "$tmp" .env
}

wait_healthy() {
  local service="$1" timeout="$2" id status waited=0
  id="$(docker compose ps -q "$service")"
  [ -n "$id" ] || return 1
  while [ "$waited" -lt "$timeout" ]; do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2> /dev/null || echo missing)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy | missing) return 1 ;;
    esac
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

# Keep the deployed image and the one before it (the rollback target).
prune_images() {
  local image="$1" keep1="$2" keep2="$3" tag
  docker image ls "$image" --format '{{.Tag}}' | while read -r tag; do
    case "$tag" in
      "$keep1" | "$keep2" | latest | '<none>') ;;
      *) docker image rm "$image:$tag" > /dev/null 2>&1 || true ;;
    esac
  done
}

main "$@"
exit
