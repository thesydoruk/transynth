/**
 * Structural markup in Disco Final Cut lockits.
 *
 * Inventory from `DialoguesLockitEnglish.po` (73 174 msgid, pack
 * `English_English_en`). Counts are dialogue-only unless noted.
 *
 * Used as:
 * - speech spans (quotes) for TTS / audio-intel
 * - a shape the Ukrainian translation must mirror
 *
 * Not markup (seen in the same file, do not treat as wrappers):
 * - `**bold**` — the one hit is censorship (`f****ts`), not emphasis
 * - `_underscore_`, `` `backticks` ``, Unicode em-dash `—` — zero hits
 * - curly apostrophes in *It's* / *You're* — contractions, not quotes
 */

export type DiscoQuoteKind = 'ascii_double' | 'curly_double' | 'guillemet';

export type DiscoMarkupSpan = {
  kind: DiscoQuoteKind | 'italic' | 'title_single' | 'ui_bracket';
  start: number;
  end: number;
  /** Inner text, trimmed. */
  content: string;
};

/** Quote pairs: EN lockit is almost only ASCII; «» appear in translations. */
export const DISCO_QUOTE_PAIR_RES: ReadonlyArray<{ kind: DiscoQuoteKind; re: RegExp }> = [
  { kind: 'ascii_double', re: /"([^"]+)"/g },
  { kind: 'curly_double', re: /\u201C([^\u201C\u201D]+)\u201D/g },
  /** Lockit occasionally uses the same curly mark on both sides (`“I am the law“`). */
  { kind: 'curly_double', re: /\u201C([^\u201C\u201D]+)\u201C/g },
  { kind: 'curly_double', re: /\u201D([^\u201C\u201D]+)\u201D/g },
  { kind: 'guillemet', re: /«([^«»]+)»/g },
];

/** `*word*` italics — 14 087 dialogue lines. Spoken; unwrap for TTS. */
export const DISCO_ITALIC_RE = /\*([^*]+)\*/g;

/**
 * `'Title'` / scare-quotes / nested singles — ~1 088 title lines
 * (`'Scab Leader'`) plus in-quote mentions (`"If by 'fun stuff,'…"`).
 * Inner English contractions (`I'll`, `C'mere`, `Weasel's`) stay inside
 * the span so the closer is the real wrapping `'`.
 * Must stay ASCII singles in translation; not a voiced-quote cut.
 */
export const DISCO_TITLE_SINGLE_RE = /(?<!\p{L})'((?:[^\n']|'(?=\p{L})){1,120})'(?!\p{L})/gu;

/** `[Leave.]`, `[Discard thought.]` — 856 lines. UI; never spoken. */
export const DISCO_UI_BRACKET_RE = /\[([^[\]]+)\]/g;

/** Em-dash written as `--` (7 836+ lines). Punctuation, not `--emphasis--`. */
export const DISCO_EM_DASH_RE = /--/g;

const collectRegexSpans = (
  text: string,
  kind: DiscoMarkupSpan['kind'],
  re: RegExp,
): DiscoMarkupSpan[] => {
  const spans: DiscoMarkupSpan[] = [];
  re.lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const content = match[1]!.trim();
    if (!content) continue;
    spans.push({
      kind,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      content,
    });
  }
  return spans;
};

/** Quote spans in appearance order (ASCII, curly, guillemets). */
export const extractDiscoQuoteSpans = (text: string): DiscoMarkupSpan[] => {
  const spans: DiscoMarkupSpan[] = [];
  for (const { kind, re } of DISCO_QUOTE_PAIR_RES) {
    spans.push(...collectRegexSpans(text, kind, re));
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
};

/** Quoted speech segments joined in order, or null when none. */
export const extractDiscoQuotedSpeech = (text: string): string | null => {
  const spans = extractDiscoQuoteSpans(text);
  if (spans.length === 0) return null;
  return spans.map((s) => s.content).join(' ');
};

/** Join quote spans by index (UK «…» aligned to EN "…"). Null if any index is missing. */
export const joinDiscoQuoteSpans = (text: string, indexes: readonly number[]): string | null => {
  if (indexes.length === 0) return null;
  const spans = extractDiscoQuoteSpans(text);
  if (indexes.some((i) => i < 0 || i >= spans.length)) return null;
  return indexes.map((i) => spans[i]!.content).join(' ');
};

/** True when letters/digits remain after stripping quote spans. */
export const hasDiscoNarrationOutsideQuotes = (text: string): boolean => {
  const spans = extractDiscoQuoteSpans(text);
  if (spans.length === 0) return false;
  let rest = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
  }
  return /[\p{L}\p{N}]/u.test(rest);
};

export const extractDiscoItalicSpans = (text: string): DiscoMarkupSpan[] =>
  collectRegexSpans(text, 'italic', DISCO_ITALIC_RE);

export const extractDiscoTitleSingleSpans = (text: string): DiscoMarkupSpan[] =>
  collectRegexSpans(text, 'title_single', DISCO_TITLE_SINGLE_RE);

export const extractDiscoUiBracketSpans = (text: string): DiscoMarkupSpan[] =>
  collectRegexSpans(text, 'ui_bracket', DISCO_UI_BRACKET_RE);

export const countDiscoEmDashes = (text: string): number =>
  text.match(DISCO_EM_DASH_RE)?.length ?? 0;

type DiscoQuoteDelim = { pos: number; kind: '"' | "'" };

/** Source `"` / `'…'` wrapper positions in appearance order. */
const collectDiscoQuoteDelims = (text: string): DiscoQuoteDelim[] => {
  const delims: DiscoQuoteDelim[] = [];
  for (const span of extractDiscoQuoteSpans(text)) {
    delims.push({ pos: span.start, kind: '"' });
    delims.push({ pos: span.end - 1, kind: '"' });
  }
  for (const span of extractDiscoTitleSingleSpans(text)) {
    delims.push({ pos: span.start, kind: "'" });
    delims.push({ pos: span.end - 1, kind: "'" });
  }
  return delims.sort((a, b) => a.pos - b.pos);
};

/**
 * Map translation `"` delimiters back onto the source quote/single sequence
 * when the model turned `'nested'` / `'Title'` into inner `"..."`.
 * No-op unless the `"` count matches that sequence and the restored shape
 * mirrors the source.
 */
export const restoreDiscoTitleSingles = (source: string, translation: string): string => {
  const srcShape = discoMarkupShape(source);
  if (srcShape.titleSingles === 0) return translation;
  const dstShape = discoMarkupShape(translation);
  if (dstShape.titleSingles >= srcShape.titleSingles) return translation;

  const delims = collectDiscoQuoteDelims(source);
  if (delims.length === 0 || !delims.some((row) => row.kind === "'")) return translation;

  const quotePositions: number[] = [];
  for (let i = 0; i < translation.length; i++) {
    if (translation[i] === '"') quotePositions.push(i);
  }
  if (quotePositions.length !== delims.length) return translation;

  const chars = translation.split('');
  let changed = false;
  for (let i = 0; i < delims.length; i++) {
    const pos = quotePositions[i]!;
    const kind = delims[i]!.kind;
    if (chars[pos] === kind) continue;
    chars[pos] = kind;
    changed = true;
  }
  if (!changed) return translation;

  const restored = chars.join('');
  const after = discoMarkupShape(restored);
  if (after.quotes === srcShape.quotes && after.titleSingles === srcShape.titleSingles) {
    return restored;
  }
  return translation;
};

/**
 * Map LLM `—` / `–` / spaced `-` back to lockit `--` when the source uses
 * that em-dash. Only fills a shortfall so extra typographic dashes stay.
 */
export const restoreDiscoEmDashes = (source: string, translation: string): string => {
  const needed = countDiscoEmDashes(source);
  if (needed === 0) return translation;
  if (countDiscoEmDashes(translation) >= needed) return translation;

  let out = translation;
  const consume = (re: RegExp, replace: (match: string, ...args: string[]) => string): void => {
    let left = needed - countDiscoEmDashes(out);
    if (left <= 0) return;
    out = out.replace(re, (match, ...args) => {
      if (left <= 0) return match;
      left -= 1;
      return replace(match, ...(args as string[]));
    });
  };

  consume(/\u2014/g, () => '--');
  consume(/\u2013/g, () => '--');
  consume(/(\s)-(\s)/g, (_match, before, after) => `${before}--${after}`);
  consume(/(\S)\s*(?:\.{3}|\u2026)\s+(\S)/g, (_match, before, after) => `${before} -- ${after}`);
  return out;
};

/** Drop surplus `--` so TTS quote/dash heuristics see the source count. */
export const trimExtraDiscoEmDashes = (source: string, translation: string): string => {
  const needed = countDiscoEmDashes(source);
  let out = translation;
  while (countDiscoEmDashes(out) > needed) {
    const at = out.lastIndexOf('--');
    if (at < 0) break;
    out = `${out.slice(0, at)} — ${out.slice(at + 2)}`.replace(/ \s+/g, ' ');
  }
  return out;
};

const unwrapShortestSpan = (text: string, spans: DiscoMarkupSpan[]): string | null => {
  if (spans.length === 0) return null;
  const nested = spans.filter((span) =>
    spans.some((other) => other !== span && other.start < span.start && other.end > span.end),
  );
  const interior = spans.filter((span) => span.start > 0);
  const candidates = nested.length > 0 ? nested : interior.length > 0 ? interior : spans;
  const victim = [...candidates].sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!victim) return null;
  return `${text.slice(0, victim.start)}${text.slice(victim.start + 1, victim.end - 1)}${text.slice(victim.end)}`;
};

const quoteCharPositions = (text: string): number[] => {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') positions.push(i);
  }
  return positions;
};

const stripQuotePair = (text: string, left: number, right: number): string =>
  `${text.slice(0, left)}${text.slice(left + 1, right)}${text.slice(right + 1)}`;

/**
 * Model often wraps unquoted names (`Archer` → `"Лучник"`). Extra `"` pair
 * as `... "Name"...` inside an outer speech line: the inner opener is the
 * first pair's closer, so span regex cannot see a nested pair. Strip the
 * two interior `"` when the source has fewer quote spans.
 */
export const unwrapExtraDiscoQuotes = (source: string, translation: string): string => {
  const neededChars = extractDiscoQuoteSpans(source).length * 2;
  let out = translation;
  for (let i = 0; i < 8; i++) {
    const positions = quoteCharPositions(out);
    if (positions.length <= neededChars || positions.length < 2) break;
    if (neededChars === 0) {
      let best = 0;
      let bestLen = Number.POSITIVE_INFINITY;
      for (let p = 0; p + 1 < positions.length; p += 2) {
        const len = positions[p + 1]! - positions[p]!;
        if (len < bestLen) {
          bestLen = len;
          best = p;
        }
      }
      out = stripQuotePair(out, positions[best]!, positions[best + 1]!);
      continue;
    }
    if (positions.length >= 4 && positions[0] === 0) {
      out = stripQuotePair(out, positions[1]!, positions[2]!);
      continue;
    }
    out = stripQuotePair(out, positions[positions.length - 2]!, positions[positions.length - 1]!);
  }
  return out;
};

/** Same as {@link unwrapExtraDiscoQuotes} for leftover `'title'` singles. */
export const unwrapExtraDiscoTitleSingles = (source: string, translation: string): string => {
  const needed = extractDiscoTitleSingleSpans(source).length;
  let out = translation;
  for (let i = 0; i < 8; i++) {
    const spans = extractDiscoTitleSingleSpans(out);
    if (spans.length <= needed) break;
    const next = unwrapShortestSpan(out, spans);
    if (!next || next === out) break;
    out = next;
  }
  return out;
};

/**
 * Force lockit shape onto an auto-translation: quotes, `'titles'`, `--`, `*italics*`.
 * Does not invent Ukrainian wording for dropped emphasis.
 */
export const restoreDiscoMarkupShape = (source: string, translation: string): string => {
  let out = translation.replace(/[«»]/g, '"');
  if (countDiscoEmDashes(source) === 0) {
    out = out.replace(/\u2013|\u2014/g, '-');
  }
  out = restoreDiscoTitleSingles(source, out);
  out = unwrapExtraDiscoQuotes(source, out);
  out = unwrapExtraDiscoTitleSingles(source, out);
  out = restoreDiscoEmDashes(source, out);
  out = trimExtraDiscoEmDashes(source, out);
  out = restoreDiscoItalics(source, out);
  return out;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Re-wrap italic markers when the source span is still a Latin token in the
 * translation (`*Prefect*`). Paraphrased emphasis is not guessed — the LLM
 * path masks `*…*` as ¤IT¤ so new translations keep the stars.
 */
export const restoreDiscoItalics = (source: string, translation: string): string => {
  const spans = extractDiscoItalicSpans(source);
  if (spans.length === 0) return translation;
  if (extractDiscoItalicSpans(translation).length >= spans.length) return translation;

  let out = translation;
  for (const span of spans) {
    if (extractDiscoItalicSpans(out).length >= spans.length) break;
    const word = span.content;
    if (!/^[A-Za-z][A-Za-z0-9](?:[A-Za-z0-9' -]*[A-Za-z0-9])?$/.test(word)) continue;
    const re = new RegExp(`(?<!\\*)\\b${escapeRegExp(word)}\\b(?!\\*)`, 'i');
    if (!re.test(out)) continue;
    out = out.replace(re, (match) => `*${match}*`);
  }
  return out;
};

/** Counts a translation must mirror (quote *kind* may change `"…"` → `«…»`). */
export type DiscoMarkupShape = {
  quotes: number;
  italics: number;
  titleSingles: number;
  emDashes: number;
  uiBrackets: number;
};

export const discoMarkupShape = (text: string): DiscoMarkupShape => ({
  quotes: extractDiscoQuoteSpans(text).length,
  italics: extractDiscoItalicSpans(text).length,
  titleSingles: extractDiscoTitleSingleSpans(text).length,
  emDashes: countDiscoEmDashes(text),
  uiBrackets: extractDiscoUiBracketSpans(text).length,
});

export type DiscoMarkupMismatch = {
  field: keyof DiscoMarkupShape;
  source: number;
  translation: number;
};

/** Shape diffs. Quote-kind swap (`"` → `«`) is OK; count must match. */
export const discoMarkupMismatches = (
  source: string,
  translation: string,
): DiscoMarkupMismatch[] => {
  const a = discoMarkupShape(source);
  const b = discoMarkupShape(translation);
  const fields: Array<keyof DiscoMarkupShape> = [
    'quotes',
    'italics',
    'titleSingles',
    'emDashes',
    'uiBrackets',
  ];
  return fields
    .filter((field) => a[field] !== b[field])
    .map((field) => ({ field, source: a[field], translation: b[field] }));
};

/** Quotes are pairing-critical; other lockit marks are fixable in-place. */
export const discoMarkupMismatchSeverity = (
  mismatches: readonly DiscoMarkupMismatch[],
): 'incorrect' | 'suspicious' | null => {
  if (mismatches.length === 0) return null;
  return mismatches.some((row) => row.field === 'quotes') ? 'incorrect' : 'suspicious';
};

export const discoMarkupMismatchReason = (mismatches: readonly DiscoMarkupMismatch[]): string => {
  const parts = mismatches.map((row) => `${row.field} ${row.source}→${row.translation}`);
  return `Disco markup mismatch: ${parts.join(', ')}.`;
};
