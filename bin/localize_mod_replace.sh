#!/usr/bin/env bash
set -euo pipefail
# Wrapper for Linux/macOS

MOD="${1:-}"
OUTDIR="${2:-}"
SRCLANG="${3:-en}"
TGTLANG="${4:-uk}"
STYLE="${5:-}"
GLOSSARY="${6:-}"

if [[ -z "$MOD" || -z "$OUTDIR" ]]; then
  echo "Usage: $0 MOD OUTDIR [SRCLANG] [TGTLANG] [STYLE] [GLOSSARY]"
  exit 1
fi

tsx ./src/cli/replaceFlow.ts \
  --mod "$MOD" --outDir "$OUTDIR" --srcLang "$SRCLANG" --tgtLang "$TGTLANG" \
  ${STYLE:+--style "$STYLE"} ${GLOSSARY:+--glossary "$GLOSSARY"}
