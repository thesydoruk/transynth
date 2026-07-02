/**
 * Heuristic detection of source strings that should not be translated.
 */
import { isNonPlayerFacingRecord } from '../formats/subrecords/nonPlayerFacing';
import { detectPexSkipFromContext } from '../formats/pex/pexTranslatableFilter';

/** Internal mask markers injected by the translation pipeline (¤PH0¤, ¤GL1¤, ¤FK2¤). */
const MARKER_RE = /¤(?:PH|GL|FK)\d+¤/g;

/**
 * Unambiguously-technical tokens that carry no translatable text.
 *
 * Intentionally conservative: only *structured* markup is stripped so that
 * prose accidentally wrapped in angle brackets (e.g. `<User "Bergman" signed in>`)
 * or bracketed stage directions (`[Sarcasm]`, `[Whispering]`) are NOT mistaken
 * for tags — those are left for the LLM to judge.
 *
 * Covered:
 * - `<Alias=…>`, `<Token.Name=…>`, `<Global=…>`, `<font face='…'>` — any tag containing `=`.
 * - `</font>`, `<br>`, `<img …>`, `<mag>`, `<p …>` — known HTML/script tags even without `=`.
 * - `%s`, `%2$d` — printf-style format specifiers.
 * - `{0}`, `{name}` — positional / named format tokens.
 * - `$Identifier` — script-style variable references.
 */
const STRUCTURED_TAG_RE = new RegExp(
  [
    String.raw`<\/?[A-Za-z][^<>]*=[^<>]*>`,
    String.raw`<\/?(?:font|img|p|br|hr|b|i|u|em|strong|mag|dur|alias|token|global)\b[^<>]*>`,
    String.raw`%\d*\$?[sdif]`,
    String.raw`\{[0-9]+\}`,
    String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
    String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
  ].join('|'),
  'gi',
);

const FORMID_RE = /^[0-9A-Fa-f]{8}$/;

const IDENTIFIER_RE = /^[A-Za-z0-9_\-:.]+$/;

/**
 * "Code-like" shape: a token that reads as an internal identifier rather than a
 * natural word or display name. Signals: an underscore, a digit, an internal
 * camelCase hump (`fooBar`), or a dotted/hyphenated path-like join (`a.b`, `a-b`).
 *
 * Plain capitalised words and names — `Minigun`, `Patrick`, `Caretaker`,
 * `Junkyard` — deliberately do NOT match, so they are never treated as an
 * editor-ID duplicate even when the record's edid happens to equal the name.
 */
const isCodeLikeIdentifier = (token: string): boolean =>
  /_/.test(token) ||
  /\d/.test(token) ||
  /[a-z][A-Z]/.test(token) ||
  /[A-Za-z][.\-][A-Za-z]/.test(token);

/** Record types whose text is a human name/label and must never be treated as a bare code. */
const NAME_BEARING_SIGNATURES = new Set(['NPC_']);

/** Any Unicode letter (Latin, Cyrillic, …) — the signal that text is translatable. */
const LETTER_RE = /\p{L}/u;

const KNOWN_LITERALS = new Set(['none', 'null', 'n/a', 'na', 'true', 'false']);

/** Bethesda Magic Particle System internal effect names (not player-facing labels). */
const MPS_PARTICLE_NAME_RE = /^MPS[A-Z][A-Za-z0-9]*$/;

/** Workshop / scene-graph light node identifiers. */
const LIGHT_NODE_NAME_RE = /^LightNode[A-Z][A-Za-z0-9]*$/;

/** EDID substrings that usually label internal effect / node records, not display names. */
const INTERNAL_EDID_MARKERS_RE =
  /(?:AddonNode|Particle|FX_|Effect|MPS_|LightNode|ImpactNode|Node\d)/i;

/** Record signatures where FULL is often an internal reference, not inventory UI. */
const INTERNAL_FULL_SIGNATURES = new Set(['ACTI', 'MSTT', 'EFSH', 'EXPL', 'PMOD', 'HAZD']);

export type SkipHeuristicHit = {
  reason: string;
  method: 'heuristic';
};

export type SkipHeuristicMeta = {
  edid?: string | null;
  path?: string | null;
  signature?: string | null;
  context?: string | null;
};

export type SkipAuditRow = {
  id: number;
  source: string;
  edid?: string | null;
  path?: string | null;
  signature?: string | null;
  context?: string | null;
};

const normalizePathField = (path: string | null | undefined): string | null => {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\\+/);
  return parts[parts.length - 1]?.toUpperCase() ?? null;
};

const isInternalFullField = (
  signature: string | null,
  path: string | null | undefined,
): boolean => {
  if (!signature || !INTERNAL_FULL_SIGNATURES.has(signature)) return false;
  const field = normalizePathField(path);
  return field === 'FULL' || field === 'DESC';
};

const isDenseInternalIdentifier = (token: string): boolean =>
  !/\s/.test(token) &&
  IDENTIFIER_RE.test(token) &&
  isCodeLikeIdentifier(token) &&
  token.length >= 10;

/**
 * Split rows into heuristic skip hits vs candidates that still need LLM audit.
 */
export const partitionSkipAuditRows = (
  rows: SkipAuditRow[],
): { heuristicHits: Map<number, SkipHeuristicHit>; llmCandidates: SkipAuditRow[] } => {
  const heuristicHits = new Map<number, SkipHeuristicHit>();
  const llmCandidates: SkipAuditRow[] = [];

  for (const row of rows) {
    const hit = detectSkipHeuristic(row.source, {
      edid: row.edid,
      path: row.path,
      signature: row.signature,
      context: row.context,
    });
    if (hit) heuristicHits.set(row.id, hit);
    else llmCandidates.push(row);
  }

  return { heuristicHits, llmCandidates };
};

/** Strip internal mask markers before analysing translatable content. */
export const stripPlaceholdersForSkipCheck = (text: string): string =>
  text.replace(MARKER_RE, '').trim();

/** Remove structured markup/format tokens and collapse the leftover whitespace. */
const stripStructuredMarkup = (text: string): string =>
  text.replace(STRUCTURED_TAG_RE, ' ').replace(/\s+/g, ' ').trim();

/**
 * Fast local rules for non-translatable game strings.
 * Returns a reason when the string should be skipped, otherwise null.
 */
export const detectSkipHeuristic = (
  source: string,
  meta?: SkipHeuristicMeta,
): SkipHeuristicHit | null => {
  const trimmed = source.trim();
  if (!trimmed) {
    return { reason: 'Empty source text.', method: 'heuristic' };
  }

  const signature = meta?.signature?.trim() ?? null;
  if (signature === 'PEX') {
    const pexHit = detectPexSkipFromContext(trimmed, meta?.context);
    if (pexHit) {
      return { reason: pexHit.reason, method: 'heuristic' };
    }
  }

  const content = stripPlaceholdersForSkipCheck(trimmed);
  if (!content) {
    return { reason: 'Source contains only placeholders or whitespace.', method: 'heuristic' };
  }

  if (content.length <= 1) {
    return { reason: 'Single-character or empty translatable fragment.', method: 'heuristic' };
  }

  // Strip structured markup (tags, variables, format specifiers) and inspect
  // what is actually left for a human to read.
  const masked = stripStructuredMarkup(content);

  if (!masked) {
    return {
      reason: 'Only markup tokens (tags, variables or format specifiers).',
      method: 'heuristic',
    };
  }

  if (!LETTER_RE.test(masked)) {
    return {
      reason: 'Numbers, symbols, separators or markup only — no translatable letters.',
      method: 'heuristic',
    };
  }

  if (KNOWN_LITERALS.has(masked.toLowerCase())) {
    return { reason: 'Known non-translatable literal token.', method: 'heuristic' };
  }

  if (FORMID_RE.test(masked)) {
    return { reason: 'FormID-like hex token.', method: 'heuristic' };
  }

  if (/[/\\]/.test(masked) && !/\s/.test(masked)) {
    return { reason: 'File or resource path (not player-facing text).', method: 'heuristic' };
  }

  if (MPS_PARTICLE_NAME_RE.test(masked)) {
    return {
      reason: 'Bethesda particle-system internal name (MPS…).',
      method: 'heuristic',
    };
  }

  if (LIGHT_NODE_NAME_RE.test(masked)) {
    return {
      reason: 'Internal light/scene node identifier (LightNode…).',
      method: 'heuristic',
    };
  }

  if (isNonPlayerFacingRecord(signature)) {
    return {
      reason: `Record type ${signature} is not player-facing (REFR/KYWD/INNR/LVLI/ARMA).`,
      method: 'heuristic',
    };
  }

  const edid = meta?.edid?.trim() ?? '';
  const internalFull = isInternalFullField(signature, meta?.path);

  if (
    internalFull &&
    isDenseInternalIdentifier(masked) &&
    (INTERNAL_EDID_MARKERS_RE.test(edid) || MPS_PARTICLE_NAME_RE.test(masked))
  ) {
    return {
      reason: 'Dense internal identifier on an effect/node record (not a display name).',
      method: 'heuristic',
    };
  }

  // Source duplicates the editor ID — but only treat it as an internal
  // reference when the text actually reads like an identifier. Otherwise a
  // legitimate name/label (e.g. an NPC called "Patrick" whose record edid is
  // also "Patrick", or a weapon "Minigun") would be wrongly skipped.
  if (edid && content.toLowerCase() === edid.toLowerCase() && isCodeLikeIdentifier(content)) {
    return { reason: 'Source duplicates editor ID (internal reference).', method: 'heuristic' };
  }

  // Short uppercase code (e.g. stat abbreviations "AGI", "AP"). Skip this rule
  // for name-bearing records so short NPC names/designations ("AJ", "X6") stay
  // translatable.
  if (
    masked.length <= 3 &&
    IDENTIFIER_RE.test(masked) &&
    masked === masked.toUpperCase() &&
    !(signature && NAME_BEARING_SIGNATURES.has(signature))
  ) {
    return { reason: 'Short uppercase identifier/code.', method: 'heuristic' };
  }

  return null;
};
