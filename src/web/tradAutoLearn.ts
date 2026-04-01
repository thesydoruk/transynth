/**
 * tradAutoLearn.ts — Rule learning (pattern discovery) from Translation Memory.
 *
 * **TradAutoGRUP** learning subsystem.  Scans existing validated
 * translation pairs in the database, groups them by GRUP signature and field
 * path, then discovers common prefix/suffix patterns that can be automatically
 * turned into TradAuto rules with `%VAR1%` placeholders.
 *
 * ## Algorithm overview
 *
 * 1. Fetch all (source, target) translation pairs for the requested game and
 *    language pair.  Only one translation per unique (source text, signature, path)
 *    triple is kept (most recently updated).
 *
 * 2. Group pairs by `(signature, path)`.  Groups smaller than the configured
 *    `minOccurrences` threshold are skipped immediately.
 *
 * 3. Within each group, perform pairwise comparison of every two pairs (A, B):
 *    a. Find the **longest common prefix** of A.source and B.source, trimmed
 *       to the last word boundary (space) so patterns stay clean.
 *    b. After removing that prefix, find the **longest common suffix** of the
 *       remaining source tails, also trimmed to a word boundary.
 *    c. The text between prefix and suffix in each source string is the
 *       **variable part** — corresponds to `%VAR1%`.
 *    d. Repeat the same prefix/suffix extraction for the target texts.
 *    e. If both source and target have non-empty variable parts AND
 *       non-trivial fixed portions (≥ 3 non-space characters), a candidate
 *       rule is produced:
 *         `pattern:     prefix + "%VAR1%" + suffix`
 *         `replacement: tgt_prefix + "%VAR1%" + tgt_suffix`
 *
 * 4. Identical candidates (same pattern + replacement + signature + path) are
 *    aggregated.  The **occurrences** counter tracks how many unique source
 *    strings matched each candidate.  Up to 5 example pairs are collected.
 *
 * 5. Candidates below the `minOccurrences` threshold or whose pattern already
 *    exists as an active TradAuto rule are discarded.  The remainder is sorted
 *    by occurrence count (descending) and trimmed to the requested `limit`.
 *
 * ## Integration
 *
 * Exposed via `POST /api/tradauto/learn` (see `routes/tradAuto.ts`).
 * The frontend presents candidates for review — the user can approve
 * individual candidates, which creates them as regular TradAuto rules via
 * the existing `POST /api/tradauto` endpoint.
 */

import type { Tx } from '../db';
import { log } from '../logger';

/* ── Public types ─────────────────────────────────────────────────────────── */

/** Options controlling the pattern-discovery run. */
export interface DiscoverOptions {
  /** Game filter (e.g. `'fo4'`, `'sse'`, `'sle'`). Default `'fo4'`. */
  game?: string;
  /** Source language.  Default `'en'`. */
  srcLang?: string;
  /** Target language.  Default `'uk'`. */
  tgtLang?: string;
  /**
   * Minimum number of unique source strings a candidate must cover to be
   * returned.  Higher values produce fewer but more reliable candidates.
   * Default: **3**.
   */
  minOccurrences?: number;
  /** Maximum number of candidates to return.  Default: **50**. */
  limit?: number;
}

/**
 * A discovered rule candidate — a pattern/replacement pair with metadata
 * about how often it occurs and which translation pairs back it up.
 */
export interface RuleCandidate {
  /** Source pattern with `%VAR1%` placeholder. */
  pattern: string;
  /** Target replacement template with `%VAR1%` placeholder. */
  replacement: string;
  /** GRUP signature scope (null = any). */
  signature: string | null;
  /** Field path scope (null = any). */
  path: string | null;
  /** Number of unique source strings that match this pattern. */
  occurrences: number;
  /** Up to 5 sample (source → target) pairs that contributed. */
  examples: Array<{ source: string; target: string }>;
}

/* ── Internal types ───────────────────────────────────────────────────────── */

/** A single (source, target) translation pair within a group. */
interface Pair {
  source: string;
  target: string;
}

/** Accumulator entry used while aggregating pairwise results. */
interface CandidateAccum {
  candidate: RuleCandidate;
  /** Unique source texts that contributed to this candidate. */
  sources: Set<string>;
}

/* ── Constants ────────────────────────────────────────────────────────────── */

/**
 * Maximum number of pairs processed per (signature, path) group.  Groups
 * larger than this are truncated to avoid excessive O(n²) pairwise work.
 */
const MAX_GROUP_SIZE = 200;

/**
 * Maximum number of example pairs stored per candidate.
 * Keeps the response payload small.
 */
const MAX_EXAMPLES = 5;

/**
 * Minimum number of non-space characters in the fixed portion of a candidate
 * pattern.  Prevents trivially short prefixes like "A %VAR1%".
 */
const MIN_FIXED_CHARS = 3;

/* ── Helper functions ─────────────────────────────────────────────────────── */

/**
 * Computes the longest common prefix of two strings and trims it back to
 * the last word boundary (the last space character within the matched
 * region).  Returns the prefix including the trailing space.
 *
 * @example
 * commonPrefix('Iron Sword', 'Iron Dagger')  // → 'Iron '
 * commonPrefix('Abc', 'Axyz')                // → ''  (no space → nothing)
 */
export const commonPrefix = (a: string, b: string): string => {
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  /* Trim to the last space within the shared region. */
  const raw = a.slice(0, i);
  const lastSpace = raw.lastIndexOf(' ');
  return lastSpace > 0 ? raw.slice(0, lastSpace + 1) : '';
};

/**
 * Computes the longest common suffix of two strings and trims it forward
 * to the nearest word boundary (the first space character within the
 * matched region, counting from the end).  Returns the suffix including
 * the leading space.
 *
 * @example
 * commonSuffix('Iron Ingot', 'Steel Ingot')  // → ' Ingot'
 * commonSuffix('Sword', 'Word')              // → ''  (no full word match)
 */
export const commonSuffix = (a: string, b: string): string => {
  let i = 0;
  const minLen = Math.min(a.length, b.length);
  while (i < minLen && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  if (i === 0) return '';
  const raw = a.slice(a.length - i);
  const firstSpace = raw.indexOf(' ');
  return firstSpace >= 0 ? raw.slice(firstSpace) : '';
};

/* ── Main discovery function ──────────────────────────────────────────────── */

/**
 * Discovers potential TradAuto rule candidates from existing translation
 * pairs stored in the database.
 *
 * This is the main entry point called by the `/api/tradauto/learn` route.
 * See module-level JSDoc for the full algorithm description.
 *
 * @param db   - Database connection (or transaction).
 * @param opts - Discovery options (game, languages, thresholds).
 * @returns Array of {@link RuleCandidate} objects sorted by occurrence count
 *          (highest first), limited to `opts.limit` entries.
 */
export const discoverPatterns = async (
  db: Tx,
  opts: DiscoverOptions = {},
): Promise<RuleCandidate[]> => {
  const {
    game = 'fo4',
    srcLang = 'en',
    tgtLang = 'uk',
    minOccurrences = 3,
    limit = 50,
  } = opts;

  log.info(`TradAuto learn: discovering patterns game=${game} ${srcLang}→${tgtLang} minOcc=${minOccurrences}`);

  /* ── 1. Fetch one canonical translation per (source text, signature, path) ── */
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.text_raw, r.signature, r.path)
            s.text_raw AS source,
            t.text     AS target,
            r.signature,
            r.path
     FROM strings s
     JOIN records r      ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id
     JOIN mods m         ON m.id = r.mod_id
     WHERE s.lang   = $1
       AND t.target_lang = $2
       AND m.game   = $3
       AND t.status NOT IN ('rejected')
       AND length(s.text_raw) > 3
     ORDER BY s.text_raw, r.signature, r.path, t.updated_at DESC`,
    [srcLang, tgtLang, game],
  );

  if (rows.length === 0) {
    log.info('TradAuto learn: no translation pairs found');
    return [];
  }

  log.info(`TradAuto learn: ${rows.length} translation pairs loaded`);

  /* ── 2. Group by (signature, path) ─────────────────────────────────────── */
  const groups = new Map<string, { sig: string | null; path: string | null; pairs: Pair[] }>();
  for (const row of rows as Array<{ source: string; target: string; signature: string | null; path: string | null }>) {
    const key = `${row.signature ?? ''}|${row.path ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, { sig: row.signature, path: row.path, pairs: [] });
    }
    groups.get(key)!.pairs.push({ source: row.source, target: row.target });
  }

  /* ── 3. Fetch existing active rule patterns to skip duplicates ─────────── */
  const { rows: existingRows } = await db.query(
    `SELECT pattern, replacement, signature, path
     FROM tradauto_rules
     WHERE is_active = TRUE AND game = $1 AND src_lang = $2 AND tgt_lang = $3`,
    [game, srcLang, tgtLang],
  );
  const existingKeys = new Set(
    (existingRows as Array<{ pattern: string; replacement: string; signature: string | null; path: string | null }>)
      .map((r) => `${r.pattern}|${r.replacement}|${r.signature ?? ''}|${r.path ?? ''}`),
  );

  /* ── 4. Pairwise pattern discovery within each group ───────────────────── */
  const candidateMap = new Map<string, CandidateAccum>();

  for (const { sig, path, pairs } of groups.values()) {
    if (pairs.length < minOccurrences) continue;

    /* Truncate very large groups to keep O(n²) manageable. */
    const limited = pairs.length > MAX_GROUP_SIZE ? pairs.slice(0, MAX_GROUP_SIZE) : pairs;

    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        const a = limited[i];
        const b = limited[j];

        /* Skip identical source texts (same text may appear via different mods). */
        if (a.source === b.source) continue;

        /* ── Source prefix / suffix ──────────────────────────────────────── */
        const srcPfx = commonPrefix(a.source, b.source);

        const srcRestA = a.source.slice(srcPfx.length);
        const srcRestB = b.source.slice(srcPfx.length);
        const srcSfx = commonSuffix(srcRestA, srcRestB);

        const sfxLen = srcSfx.length;
        const srcVarA = srcRestA.slice(0, srcRestA.length - sfxLen).trim();
        const srcVarB = srcRestB.slice(0, srcRestB.length - sfxLen).trim();

        /* Both variables must be non-empty. */
        if (!srcVarA || !srcVarB) continue;
        /* At least one of prefix/suffix must exist (purely variable = useless). */
        if (!srcPfx && !srcSfx) continue;
        /* Minimum fixed-text length check. */
        const fixedChars = (srcPfx.trim() + srcSfx.trim()).replace(/\s/g, '').length;
        if (fixedChars < MIN_FIXED_CHARS) continue;

        /* ── Target prefix / suffix ──────────────────────────────────────── */
        const tgtPfx = commonPrefix(a.target, b.target);
        const tgtRestA = a.target.slice(tgtPfx.length);
        const tgtRestB = b.target.slice(tgtPfx.length);
        const tgtSfx = commonSuffix(tgtRestA, tgtRestB);

        const tgtSfxLen = tgtSfx.length;
        const tgtVarA = tgtRestA.slice(0, tgtRestA.length - tgtSfxLen).trim();
        const tgtVarB = tgtRestB.slice(0, tgtRestB.length - tgtSfxLen).trim();

        if (!tgtVarA || !tgtVarB) continue;
        if (!tgtPfx && !tgtSfx) continue;

        /* ── Build candidate ─────────────────────────────────────────────── */
        const pattern = `${srcPfx}%VAR1%${srcSfx}`;
        const replacement = `${tgtPfx}%VAR1%${tgtSfx}`;

        /* Skip candidates that duplicate an existing active rule. */
        const existKey = `${pattern}|${replacement}|${sig ?? ''}|${path ?? ''}`;
        if (existingKeys.has(existKey)) continue;

        /* ── Aggregate ───────────────────────────────────────────────────── */
        const candKey = existKey;
        if (!candidateMap.has(candKey)) {
          candidateMap.set(candKey, {
            candidate: {
              pattern,
              replacement,
              signature: sig ?? null,
              path: path ?? null,
              occurrences: 0,
              examples: [],
            },
            sources: new Set(),
          });
        }

        const entry = candidateMap.get(candKey)!;
        if (!entry.sources.has(a.source) && entry.candidate.examples.length < MAX_EXAMPLES) {
          entry.candidate.examples.push({ source: a.source, target: a.target });
        }
        if (!entry.sources.has(b.source) && entry.candidate.examples.length < MAX_EXAMPLES) {
          entry.candidate.examples.push({ source: b.source, target: b.target });
        }
        entry.sources.add(a.source);
        entry.sources.add(b.source);
      }
    }
  }

  /* ── 5. Filter, sort, limit ────────────────────────────────────────────── */
  const results: RuleCandidate[] = [];
  for (const { candidate, sources } of candidateMap.values()) {
    candidate.occurrences = sources.size;
    if (candidate.occurrences >= minOccurrences) {
      results.push(candidate);
    }
  }

  results.sort((a, b) => b.occurrences - a.occurrences);

  log.info(`TradAuto learn: ${candidateMap.size} raw candidates → ${results.length} above threshold (limit ${limit})`);

  return results.slice(0, limit);
};
