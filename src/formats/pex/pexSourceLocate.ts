/**
 * Locate translatable string literals inside decompiled Papyrus (.psc) text.
 */
import { normalizePexScriptKey } from './pexParser';

export type PexSourceLine = {
  lineNumber: number;
  text: string;
  highlight: boolean;
};

export type PexSourceLocateResult = {
  /** Display name, usually `ScriptName.psc`. */
  scriptLabel: string;
  /** Full path from the PEX header when present. */
  headerSourceFile: string | null;
  /** 1-based line numbers where the literal appears. */
  matchLineNumbers: number[];
  /** Window around the primary match for UI display. */
  contextLines: PexSourceLine[];
};

/** `PEX\\ScriptName` → `scriptname` (lowercase key used by import). */
export const pexScriptKeyFromRecordPath = (recordPath: string): string | null => {
  const trimmed = recordPath.trim();
  if (!trimmed.toUpperCase().startsWith('PEX\\')) return null;
  const key = trimmed.slice(4).trim();
  if (!key) return null;
  return normalizePexScriptKey(key).toLowerCase();
};

const CONTEXT_RADIUS = 4;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lines in `.psc` source that reference the given literal text. */
export const findPexLiteralLineNumbers = (pscSource: string, literal: string): number[] => {
  const needle = literal.trim();
  if (!needle) return [];

  const lines = pscSource.split(/\r?\n/);
  const matches = new Set<number>();
  const quotedPatterns = [
    new RegExp(`"\\s*${escapeRegExp(needle)}\\s*"`),
    new RegExp(`'\\s*${escapeRegExp(needle)}\\s*'`),
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (quotedPatterns.some((pattern) => pattern.test(line)) || line.includes(needle)) {
      matches.add(i + 1);
    }
  }

  return [...matches].sort((a, b) => a - b);
};

const buildContextWindow = (
  lines: string[],
  matchLineNumbers: number[],
  radius = CONTEXT_RADIUS,
): PexSourceLine[] => {
  if (matchLineNumbers.length === 0) return [];
  const primary = matchLineNumbers[0]!;
  const minLine = Math.max(1, primary - radius);
  const maxLine = Math.min(lines.length, primary + radius);
  const highlight = new Set(matchLineNumbers);
  const context: PexSourceLine[] = [];

  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber++) {
    context.push({
      lineNumber,
      text: lines[lineNumber - 1] ?? '',
      highlight: highlight.has(lineNumber),
    });
  }

  return context;
};

/**
 * Find a string literal inside decompiled Papyrus source and return a UI snippet.
 */
export const locatePexLiteralInPsc = (
  pscSource: string,
  literal: string,
  opts?: { scriptLabel?: string; headerSourceFile?: string | null },
): PexSourceLocateResult | null => {
  const matchLineNumbers = findPexLiteralLineNumbers(pscSource, literal);
  if (matchLineNumbers.length === 0) return null;

  const lines = pscSource.split(/\r?\n/);
  const header = opts?.headerSourceFile?.trim() || null;
  const scriptLabel = opts?.scriptLabel?.trim() || (header ? pathBasename(header) : 'script.psc');

  return {
    scriptLabel,
    headerSourceFile: header,
    matchLineNumbers,
    contextLines: buildContextWindow(lines, matchLineNumbers),
  };
};

const pathBasename = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
};
