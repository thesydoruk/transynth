#!/bin/bash
# One-off: bind-mount local (rsynced) source over the image and dry-run dialog LLM.
set -euo pipefail
cd ~/Source/transynth
docker compose run --rm --no-deps --entrypoint '' \
  -v "$HOME/Source/transynth/src:/app/src" \
  -v "$HOME/Source/transynth/scripts:/app/scripts" \
  -v "$HOME/Source/transynth/worker:/app/worker" \
  web node --import tsx/esm scripts/fo4UkDialogDryRun.ts "$@" \
  > "${FO4_DRYRUN_OUT:-/tmp/fo4-uk-dialog-dryrun.json}"
