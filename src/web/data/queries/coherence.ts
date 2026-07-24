import type { Tx } from '../../../db';
import type pg from 'pg';
import { withTransaction } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { upsertTranslation } from './translationsUpsert';

// ── Coherence checking ────────────────────────────────────────────────────────

/**
 * A single string entry within a coherence group.
 * Represents one source string whose translation differs from at least one
 * other string that shares the same normalised source text.
 */
export type CoherenceEntry = {
  string_id: number;
  /** Raw (un-normalised) source text — used for informational display. */
  source_text: string;
  /** Normalised source text hash — the group key. */
  text_norm: string;
  edid: string | null;
  signature: string;
  path_simplified: string;
  mod_id: number;
  mod_name: string;
  /** Game identifier for the mod — used for editor deep-links. */
  mod_game: string;
  translation_id: number | null;
  /** Current best translation for this string. */
  translation: string;
  status: string;
};

/**
 * A coherence group — all strings sharing the same normalised source text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  text_norm: string;
  /** A representative raw source text for display purposes. */
  source_text: string;
  /** Number of distinct translation variants across all strings in this group. */
  variant_count: number;
  /** All string entries belonging to this group. */
  entries: CoherenceEntry[];
};

/**
 * Paginated coherence report result.
 */
export type CoherenceResult = {
  groups: CoherenceGroup[];
  /** Total number of inconsistency groups (before pagination). */
  total: number;
};

/**
 * Returns a paginated coherence report — groups of source strings that share
 * the same normalised text but have been translated inconsistently across
 * different strings/mods.
 *
 * Algorithm:
 * 1. Join each source string to its single translation for the target lang
 *    (unique on `(src_string_id, target_lang)`).
 * 2. Group source strings by text_norm. Groups where COUNT(DISTINCT translation) > 1
 *    are inconsistent.
 * 3. Paginate over the inconsistent groups (ordered by variant_count DESC so the
 *    most conflicted groups appear first).
 * 4. For each group returned on the current page, fetch all member strings with
 *    their current translations.
 *
 * @param db       - Database connection or pool.
 * @param targetLang - Language code to check (e.g. 'uk').
 * @param limit    - Max number of groups per page.
 * @param offset   - Group offset for pagination.
 */
export const getCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  limit = 50,
  offset = 0,
  srcLang = CONFIG.defaultSrcLang,
): Promise<CoherenceResult> => {
  // One translation per (string, lang) — uniqueness is schema-enforced.
  const btCte = `
    bt AS (
      SELECT
        src_string_id,
        text               AS translation,
        status,
        id                 AS translation_id,
        COALESCE(confidence, 0) AS conf,
        updated_at
      FROM translations
      WHERE target_lang = $1
    )`;

  // ── Step 1: total count of inconsistent groups ────────────────────────────
  const { rows: countRows } = await db.query<{ n: string }>(
    `WITH ${btCte}
     SELECT COUNT(*) AS n
     FROM (
       SELECT s.text_norm
       FROM   strings s
       JOIN   bt ON bt.src_string_id = s.id
       WHERE  s.lang = $2
         AND  s.text_norm IS NOT NULL
         AND  s.text_norm <> ''
       GROUP  BY s.text_norm
       HAVING COUNT(DISTINCT bt.translation) > 1
     ) x`,
    [targetLang, srcLang],
  );
  const total = Number(countRows[0]?.n ?? 0);

  if (total === 0) return { groups: [], total: 0 };

  // ── Step 2: paginated list of inconsistent text_norms ────────────────────
  const { rows: normRows } = await db.query<{
    text_norm: string;
    source_text: string;
    variant_count: string;
  }>(
    `WITH ${btCte}
     SELECT s.text_norm,
            MIN(s.text_raw)                    AS source_text,
            COUNT(DISTINCT bt.translation)     AS variant_count
     FROM   strings s
     JOIN   bt ON bt.src_string_id = s.id
     WHERE  s.lang = $2
       AND  s.text_norm IS NOT NULL
       AND  s.text_norm <> ''
     GROUP  BY s.text_norm
     HAVING COUNT(DISTINCT bt.translation) > 1
     ORDER  BY variant_count DESC, s.text_norm
     LIMIT  $3 OFFSET $4`,
    [targetLang, srcLang, limit, offset],
  );

  if (normRows.length === 0) return { groups: [], total };

  // ── Step 3: fetch all member strings for the norms on this page ──────────
  const textNorms = normRows.map((r) => r.text_norm);
  const { rows: entryRows } = await db.query<CoherenceEntry>(
    `WITH ${btCte}
     SELECT s.id             AS string_id,
            s.text_raw       AS source_text,
            s.text_norm,
            r.edid,
            r.signature,
            r.path_simplified,
            m.id             AS mod_id,
            m.name           AS mod_name,
            m.game           AS mod_game,
            bt.translation_id,
            bt.translation,
            bt.status
     FROM   strings s
     JOIN   bt       ON bt.src_string_id = s.id
     JOIN   records  r ON r.id = s.record_id
     JOIN   mods     m ON m.id = r.mod_id
     WHERE  s.lang = $2
       AND  s.text_norm = ANY($3)
     ORDER  BY s.text_norm, bt.translation, m.name`,
    [targetLang, srcLang, textNorms],
  );

  // ── Step 4: assemble groups in JS ────────────────────────────────────────
  // Build an index from norm → {source_text, variant_count} using normRows
  const normMeta = new Map(
    normRows.map((r) => [
      r.text_norm,
      { source_text: r.source_text, variant_count: Number(r.variant_count) },
    ]),
  );

  // Group entry rows by text_norm, preserving the pagination order
  const groupMap = new Map<string, CoherenceEntry[]>();
  for (const entry of entryRows) {
    let list = groupMap.get(entry.text_norm);
    if (!list) {
      list = [];
      groupMap.set(entry.text_norm, list);
    }
    list.push(entry);
  }

  // Re-sort groups by normRows order (normRows is already ordered by variant_count DESC)
  const groups: CoherenceGroup[] = normRows
    .filter((r) => groupMap.has(r.text_norm))
    .map((r) => ({
      text_norm: r.text_norm,
      source_text: normMeta.get(r.text_norm)!.source_text,
      variant_count: normMeta.get(r.text_norm)!.variant_count,
      entries: groupMap.get(r.text_norm) ?? [],
    }));

  return { groups, total };
};

/**
 * Resolves all inconsistencies within a coherence group by applying a single
 * chosen translation to every string in the group that currently has a
 * different translation.
 *
 * Only strings that *already have a translation* (but a different one) are
 * updated. Strings without any translation are left untouched — the caller
 * should handle those separately if needed.
 *
 * All updates run inside a single transaction so either all succeed or none do.
 *
 * @param db                - Database pool (transaction is acquired internally).
 * @param textNorm          - The normalised source text that identifies the group.
 * @param targetLang        - Language code to update (e.g. 'uk').
 * @param chosenTranslation - The single translation text to propagate.
 * @returns Number of strings actually updated.
 */
export const resolveCoherenceGroup = async (
  db: Tx,
  textNorm: string,
  targetLang: string,
  chosenTranslation: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ updated: number }> => {
  // Find all strings in the group whose translation differs from the chosen one
  const { rows } = await db.query<{ string_id: number }>(
    `SELECT s.id AS string_id
     FROM   strings s
     JOIN   translations t ON t.src_string_id = s.id AND t.target_lang = $1
     WHERE  s.lang = $4
       AND  s.text_norm = $2
       AND  t.text <> $3`,
    [targetLang, textNorm, chosenTranslation, srcLang],
  );

  if (rows.length === 0) return { updated: 0 };

  // Apply the chosen translation to every differing string in a transaction
  await withTransaction(db as pg.Pool, async (client) => {
    for (const row of rows) {
      await upsertTranslation(
        client,
        row.string_id,
        chosenTranslation,
        'reviewed',
        targetLang,
        'coherence_resolve',
      );
    }
  });

  return { updated: rows.length };
};

/**
 * Auto-resolves all coherence inconsistencies for a target language by
 * applying the plurality-winner translation to every inconsistent group.
 *
 * Winner selection per group:
 * 1. Usage count — the translation currently used by the most strings wins.
 * 2. Status quality — human > reviewed > tm > fuzzy > auto > draft, as a tie-breaker.
 * 3. Alphabetical order — for determinism when count and quality are tied.
 *
 * @param db         - Database pool (each group's writes use its own internal transaction).
 * @param targetLang - Target language code to resolve (e.g. 'uk').
 * @param srcLang    - Source language code (default: CONFIG.defaultSrcLang).
 * @returns          - Number of groups resolved and total strings updated.
 */
export const resolveAllCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ resolved: number; updated: number }> => {
  // Inline status weight expression reused in both DISTINCT ON order and
  // aggregate quality computation.
  const statusWeight = `CASE status WHEN 'human' THEN 6 WHEN 'reviewed' THEN 5 WHEN 'tm' THEN 4 WHEN 'fuzzy' THEN 3 WHEN 'auto' THEN 2 ELSE 1 END`;

  // Find the plurality winner for every inconsistent text_norm in one query:
  //   bt            — translation per string (unique on src_string_id + target_lang)
  //   group_variants — usage count + max quality per (text_norm, translation) pair
  //   conflicted    — text_norms that have more than one distinct translation variant
  //   page_winners  — DISTINCT ON picks best translation per group by count → quality → text
  const { rows: winners } = await db.query<{ text_norm: string; translation: string }>(
    `WITH bt AS (
       SELECT
         src_string_id,
         text                  AS translation,
         ${statusWeight}       AS quality
       FROM translations
       WHERE target_lang = $1
     ),
     group_variants AS (
       SELECT s.text_norm,
              bt.translation,
              COUNT(*)::int      AS usage_count,
              MAX(bt.quality)::int AS best_quality
       FROM strings s
       JOIN bt ON bt.src_string_id = s.id
       WHERE s.lang = $2
         AND s.text_norm IS NOT NULL
         AND s.text_norm <> ''
       GROUP BY s.text_norm, bt.translation
     ),
     conflicted AS (
       SELECT text_norm
       FROM group_variants
       GROUP BY text_norm
       HAVING COUNT(DISTINCT translation) > 1
     ),
     page_winners AS (
       SELECT DISTINCT ON (gv.text_norm)
         gv.text_norm,
         gv.translation
       FROM group_variants gv
       JOIN conflicted c ON c.text_norm = gv.text_norm
       ORDER BY gv.text_norm, gv.usage_count DESC, gv.best_quality DESC, gv.translation
     )
     SELECT text_norm, translation FROM page_winners`,
    [targetLang, srcLang],
  );

  let totalUpdated = 0;
  for (const winner of winners) {
    const result = await resolveCoherenceGroup(
      db,
      winner.text_norm,
      targetLang,
      winner.translation,
    );
    totalUpdated += result.updated;
  }
  log.info(
    `resolve-all coherence: targetLang=${targetLang} resolved=${winners.length} updated=${totalUpdated}`,
  );
  return { resolved: winners.length, updated: totalUpdated };
};
