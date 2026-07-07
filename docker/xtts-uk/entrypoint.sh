#!/bin/bash
set -euo pipefail

CKPT_DIR="${XTTS_CHECKPOINT_DIR:-/data/xtts/checkpoints}"
BASE_DIR="${CKPT_DIR}/XTTS_v2.0_original_model_files"
SPEAKERS_DIR="${XTTS_SPEAKERS_DIR:-/data/xtts/speakers}"
OUTPUT_DIR="${XTTS_OUTPUT_DIR:-/data/xtts/output}"
MODEL_ID="${XTTS_UK_MODEL_ID:-mouseyy/xttsv2-ukrainian_22012}"

mkdir -p "${BASE_DIR}" "${SPEAKERS_DIR}" "${OUTPUT_DIR}"

download_base_file() {
  local url="$1"
  local dest="$2"
  if [ -f "${dest}" ]; then
    return 0
  fi
  echo "Downloading $(basename "${dest}")..."
  curl -fL --retry 3 --retry-delay 5 -o "${dest}" "${url}"
}

echo "Ensuring XTTS v2 base weights in ${BASE_DIR}..."
download_base_file \
  "https://coqui.gateway.scarf.sh/hf-coqui/XTTS-v2/main/dvae.pth" \
  "${BASE_DIR}/dvae.pth"
download_base_file \
  "https://coqui.gateway.scarf.sh/hf-coqui/XTTS-v2/main/mel_stats.pth" \
  "${BASE_DIR}/mel_stats.pth"
download_base_file \
  "https://coqui.gateway.scarf.sh/hf-coqui/XTTS-v2/main/model.pth" \
  "${BASE_DIR}/model.pth"

if [ ! -f "${CKPT_DIR}/best_model.pth" ] || [ ! -f "${CKPT_DIR}/config.json" ] || [ ! -f "${CKPT_DIR}/vocab.json" ]; then
  echo "Downloading Ukrainian fine-tune ${MODEL_ID}..."
  python3 - <<'PY'
import os
from huggingface_hub import hf_hub_download

model_id = os.environ.get("XTTS_UK_MODEL_ID", "mouseyy/xttsv2-ukrainian_22012")
ckpt_dir = os.environ.get("XTTS_CHECKPOINT_DIR", "/data/xtts/checkpoints")
token = os.environ.get("HF_TOKEN") or None

for filename in ("best_model.pth", "config.json", "vocab.json"):
    path = os.path.join(ckpt_dir, filename)
    if os.path.isfile(path):
        continue
    print(f"  {filename}...")
    hf_hub_download(
        repo_id=model_id,
        filename=filename,
        local_dir=ckpt_dir,
        token=token,
    )
PY
fi

exec python3 /app/server.py
