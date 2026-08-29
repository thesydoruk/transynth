/**
 * Decide whether a PEX string-table literal is worth importing for translation.
 *
 * Primary signal: quoted occurrences in decompiled `.psc` source (Champollion).
 * Fallback: bytecode usage hints when PSC is unavailable.
 */
import type { PexStringUsage } from './usage';
import { isLikelyUserText } from './pexParser';
import { parsePexStoredContext } from './pexStoredContext';

export type PscQuotedLineClass = 'player-facing' | 'debug' | 'technical' | 'unknown';

export type PexTranslatabilityVerdict = {
  include: boolean;
  reason: string;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Debug-only Papyrus calls — never player-facing. */
export const PEX_DEBUG_CALL_RE =
  /\bDebug\.(?:Trace(?:Stack|This)?|Message|Warning|Assert|Dump)\s*\(/i;

/** Dev / wiring calls where quoted strings are IDs, events, or asset names. */
export const PEX_TECHNICAL_CALL_RE =
  /\b(?:RegisterFor\w+|Send(?:Custom|Animation)Event|PlaySound|Cast|GetFormFromFile|Game\.GetForm(?:FromFile)?|AddPerk|RemovePerk|EquipItem|SetOpenState|StartCannibal|Find|GetKeyword|HasKeyword|IsSpellTarget|GetLinkedRef(?:Chain)?|StartTimer|RegisterForSingleUpdate|RegisterForMenuOpenEvent|GetAnimationVariable|SetAnimationVariable|SendStoryEvent|EvaluatePackage|AddScriptPackage|PushActorAway|GetDistance|IsInInterior|GetCurrentLocation|GetFactionRank|HasMagicEffect|GetItemCount|GetValue|SetValue|FindMatchingRef|GetPropertyValue|SetPropertyValue)\s*\(/i;

const SCRIPT_META_RE = /^\s*(?:Scriptname|extends|import)\b/i;

/** Calls that usually pass UI / dialogue text to the player. */
export const PEX_PLAYER_FACING_CALL_RE =
  /\b(?:MessageBox(?:\.\w+)?|Notification|Show(?:Message|Subtitle|Title|RankMenu)|AddTopic|Say|SetObjective(?:Displayed|Completed)?|SetStage|DisplayMessage|ShowBarterMenu|ShowGiftMenu|ShowWarning|ShowTutorial|AddHUDMessage|ShowQuestStage|ShowCustomMessage|AddText|SetText|AddHUDMessage|ShowFloatingMessage)\s*\(/i;

const DEBUG_USAGE_HINT_RE = /^Debug\.(?:Trace(?:Stack|This)?|Message|Warning|Assert)/i;

const COMMA_IDENTIFIER_LIST_RE = /^[A-Za-z0-9_]+(?:,\s*[A-Za-z0-9_]+)+$/;

const PAPYRUS_LITERAL_RE = /^[A-Za-z0-9_]+(?:,\s*[A-Za-z0-9_]+)*$/;

const ENGINE_LITERAL_RE = /^(?:None|True|False|Self|Parent)$/i;

/** Lines in `.psc` where `literal` appears inside a string literal. */
export const findQuotedPscLinesForLiteral = (
  pscSource: string,
  literal: string,
): { lineNumber: number; line: string }[] => {
  const needle = literal.trim();
  if (!needle) return [];

  const escaped = escapeRegExp(needle);
  const quotedPatterns = [
    new RegExp(`"[^"\\n]*${escaped}[^"\\n]*"`),
    new RegExp(`'[^'\\n]*${escaped}[^'\\n]*'`),
  ];

  const lines = pscSource.split(/\r?\n/);
  const matches: { lineNumber: number; line: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const code = raw.split(';')[0] ?? raw;
    if (!code.trim()) continue;
    if (!quotedPatterns.some((pattern) => pattern.test(code))) continue;
    matches.push({ lineNumber: i + 1, line: code });
  }

  return matches;
};

const unescapePapyrusString = (value: string): string =>
  value.replace(/\\(.)/g, (_match, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    if (ch === 'r') return '\r';
    return ch;
  });

/** All string literals appearing in quotes inside decompiled `.psc` source. */
export const extractQuotedStringLiteralsFromPsc = (pscSource: string): string[] => {
  const literals = new Set<string>();
  for (const rawLine of pscSource.split(/\r?\n/)) {
    const code = rawLine.split(';')[0] ?? rawLine;
    for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      if (match[1] != null) literals.add(unescapePapyrusString(match[1]));
    }
    for (const match of code.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      if (match[1] != null) literals.add(unescapePapyrusString(match[1]));
    }
  }
  return [...literals];
};

/** Natural-language shape for PEX literals (includes short UI labels). */
export const isNaturalLanguagePexLiteral = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (ENGINE_LITERAL_RE.test(trimmed)) return false;
  if (COMMA_IDENTIFIER_LIST_RE.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return /\p{L}/u.test(trimmed);
  if (/[!?.]/.test(trimmed)) return true;
  if (trimmed.length >= 4 && trimmed.length <= 32 && /^[A-Z][A-Za-z0-9' -]+$/.test(trimmed)) {
    return true;
  }
  return false;
};

/** Classify one `.psc` code line that already contains a quoted literal match. */
export const classifyPscQuotedLine = (line: string): PscQuotedLineClass => {
  const trimmed = line.trim();
  if (!trimmed || SCRIPT_META_RE.test(trimmed)) return 'technical';
  if (PEX_DEBUG_CALL_RE.test(trimmed)) return 'debug';
  if (PEX_PLAYER_FACING_CALL_RE.test(trimmed)) return 'player-facing';
  if (PEX_TECHNICAL_CALL_RE.test(trimmed)) return 'technical';
  if (/\b(?:Trace|Log|Print|Dump|Assert)\s*\(/i.test(trimmed)) return 'debug';
  return 'unknown';
};

const isDebugStringPrefixConcat = (line: string, literal: string): boolean => {
  const prefixMatch = line.match(/["']([^"']+)["']\s*\+/);
  if (!prefixMatch) return false;
  if (prefixMatch[1]?.trim() !== literal.trim()) return false;
  return !PEX_PLAYER_FACING_CALL_RE.test(line);
};

/** Refine PSC lines initially marked `unknown`. */
export const refineUnknownPscLine = (line: string, literal: string): PscQuotedLineClass => {
  const trimmedLiteral = literal.trim();
  if (!trimmedLiteral) return 'technical';
  if (ENGINE_LITERAL_RE.test(trimmedLiteral)) return 'technical';
  if (COMMA_IDENTIFIER_LIST_RE.test(trimmedLiteral)) return 'technical';
  if (
    PAPYRUS_LITERAL_RE.test(trimmedLiteral) &&
    !/\s/.test(trimmedLiteral) &&
    trimmedLiteral.length >= 8
  ) {
    return 'technical';
  }
  if (isDebugStringPrefixConcat(line, trimmedLiteral)) return 'debug';
  if (PEX_TECHNICAL_CALL_RE.test(line)) return 'technical';
  if (isNaturalLanguagePexLiteral(trimmedLiteral)) return 'unknown';
  return 'technical';
};

const resolvePscLineClass = (line: string, literal: string): PscQuotedLineClass => {
  const kind = classifyPscQuotedLine(line);
  return kind === 'unknown' ? refineUnknownPscLine(line, literal) : kind;
};

const classifyFromPsc = (pscSource: string, literal: string): PscQuotedLineClass[] => {
  const quotedLines = findQuotedPscLinesForLiteral(pscSource, literal);
  return quotedLines.map((entry) => resolvePscLineClass(entry.line, literal));
};

const isDebugOnlyBytecodeUsage = (usages: PexStringUsage[]): boolean =>
  usages.length > 0 &&
  usages.every((usage) => usage.usageHint != null && DEBUG_USAGE_HINT_RE.test(usage.usageHint));

const isTranslatablePscClass = (kind: PscQuotedLineClass): boolean =>
  kind === 'player-facing' || kind === 'unknown';

/**
 * Detailed import-time verdict for one PEX literal.
 *
 * @param pscSource - Decompiled `.psc` text when Champollion succeeded.
 */
export const resolvePexTranslatability = (
  text: string,
  usages: PexStringUsage[],
  pscSource?: string | null,
): PexTranslatabilityVerdict => {
  const psc = pscSource?.trim();

  if (psc) {
    const classes = classifyFromPsc(psc, text);
    if (classes.length === 0) {
      return { include: false, reason: 'literal not quoted in PSC' };
    }
    if (classes.some(isTranslatablePscClass)) {
      return { include: true, reason: 'quoted PSC usage is player-facing or natural language' };
    }
    return { include: false, reason: 'quoted PSC usage is debug or technical only' };
  }

  if (!isLikelyUserText(text)) {
    return { include: false, reason: 'failed text heuristic without PSC' };
  }
  if (usages.length === 0) {
    return { include: false, reason: 'no bytecode usage and no PSC' };
  }
  if (isDebugOnlyBytecodeUsage(usages)) {
    return { include: false, reason: 'debug-only bytecode usage' };
  }
  return { include: true, reason: 'bytecode usage without PSC' };
};

/**
 * Return `true` when a PEX literal should be ingested as a translatable row.
 *
 * @param pscSource - Decompiled `.psc` text when Champollion succeeded.
 */
export const isPexLiteralTranslatable = (
  text: string,
  usages: PexStringUsage[],
  pscSource?: string | null,
): boolean => resolvePexTranslatability(text, usages, pscSource).include;

/** Skip-detect helper for already-imported PEX rows (uses stored PSC snippet). */
export const detectPexSkipFromContext = (
  source: string,
  context: string | null | undefined,
): { reason: string } | null => {
  const trimmed = source.trim();
  if (!trimmed) return { reason: 'Empty PEX literal.' };

  if (COMMA_IDENTIFIER_LIST_RE.test(trimmed)) {
    return { reason: 'Comma-separated internal identifier list in PEX literal.' };
  }

  if (ENGINE_LITERAL_RE.test(trimmed)) {
    return { reason: 'Papyrus engine literal token in PEX string table.' };
  }

  const stored = parsePexStoredContext(context);
  const codeLines = stored
    ? stored.contextLines.map((line) => line.text).filter(Boolean)
    : (context?.trim() ? context.split(/\r?\n/) : []).filter(Boolean);

  for (const line of codeLines) {
    const kind = resolvePscLineClass(line, trimmed);
    if (kind === 'debug' || kind === 'technical') {
      return {
        reason:
          kind === 'debug'
            ? 'PEX literal appears in Debug/log call site.'
            : 'PEX literal appears in technical wiring call site.',
      };
    }
  }

  return null;
};
