import type { PexSourceLocateResult } from './pexSourceLocate';

/** Prefix for JSON PEX context stored in `strings.context` at import time. */
export const PEX_STORED_CONTEXT_PREFIX = 'pex-json:';

export const serializePexStoredContext = (snippet: PexSourceLocateResult): string =>
  PEX_STORED_CONTEXT_PREFIX +
  JSON.stringify({
    scriptLabel: snippet.scriptLabel,
    headerSourceFile: snippet.headerSourceFile,
    matchLineNumbers: snippet.matchLineNumbers,
    contextLines: snippet.contextLines,
  });

export const parsePexStoredContext = (
  value: string | null | undefined,
): PexSourceLocateResult | null => {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith(PEX_STORED_CONTEXT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      trimmed.slice(PEX_STORED_CONTEXT_PREFIX.length),
    ) as PexSourceLocateResult;
    if (!parsed || !Array.isArray(parsed.contextLines)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const formatPexStoredContextLabel = (snippet: PexSourceLocateResult): string => {
  const line = snippet.matchLineNumbers[0];
  return line != null ? `${snippet.scriptLabel} · line ${line}` : snippet.scriptLabel;
};
