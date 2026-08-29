/** Must match `src/formats/pex/pexStoredContext.ts`. */
export const PEX_STORED_CONTEXT_PREFIX = 'pex-json:';

export type PexSourceLine = {
  lineNumber: number;
  text: string;
  highlight: boolean;
};

export type PexSourceSnippet = {
  scriptLabel: string;
  headerSourceFile: string | null;
  matchLineNumbers: number[];
  contextLines: PexSourceLine[];
};

export const parsePexStoredContext = (
  value: string | null | undefined,
): PexSourceSnippet | null => {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith(PEX_STORED_CONTEXT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(PEX_STORED_CONTEXT_PREFIX.length)) as PexSourceSnippet;
    if (!parsed || !Array.isArray(parsed.contextLines)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const formatPexStoredContextLabel = (snippet: PexSourceSnippet): string => {
  const line = snippet.matchLineNumbers[0];
  return line != null ? `${snippet.scriptLabel} · line ${line}` : snippet.scriptLabel;
};
