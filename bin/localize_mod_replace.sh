#!/usr/bin/env bash
set -euo pipefail
# Wrapper for Linux/macOS with Wine

XEDIT="${1:-}"
EXPORTER="${2:-}"
APPLIER="${3:-}"
MOD="${4:-}"
OUTDIR="${5:-}"
SRCLANG="${6:-en}"
TGTLANG="${7:-uk}"
STYLE="${8:-}"
GLOSSARY="${9:-}"

if [[ -z "$XEDIT" || -z "$EXPORTER" || -z "$APPLIER" || -z "$MOD" || -z "$OUTDIR" ]]; then
  echo "Usage: $0 XEDIT EXPORTER APPLIER MOD OUTDIR [SRCLANG] [TGTLANG] [STYLE] [GLOSSARY]"
  exit 1
fi

tsx ./src/cli/replaceFlow.ts --xedit "$XEDIT" --exporter "$EXPORTER" --applier "$APPLIER" \
  --mod "$MOD" --outDir "$OUTDIR" --srcLang "$SRCLANG" --tgtLang "$TGTLANG" \
  ${STYLE:+--style "$STYLE"} ${GLOSSARY:+--glossary "$GLOSSARY"}
