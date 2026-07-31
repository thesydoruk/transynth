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
 * other string that shares the same exact source text.
 */
export type CoherenceEntry = {
  string_id: number;
  /** Exact source text — also the group key. */
  source_text: string;
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
 * A coherence group — all strings sharing the same exact source text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  /** Exact source text that identifies this group. */
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

/** Shared CTE: one translation per string for the target language. */
const bestTranslationCte = `
  bt AS (
    SELECT
      src_string_id,
      text               AS translation,
      status,
      id                 AS translation_id
    FROM translations
    WHERE target_lang = $1
  )`;

/**
 * Returns a paginated coherence report — groups of source strings that share
 * the same exact `text_raw` but have been translated inconsistently.
 *
 * Groups by exact source text (not `text_norm`) so numbers and placeholders
 * that differ in the raw string are not collapsed into false conflicts.
 */
export const getCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  limit = 50,
  offset = 0,
  srcLang = CONFIG.defaultSrcLang,
): Promise<CoherenceResult> => {
  const { rows: countRows } = await db.query<{ n: string }>(
    `WITH ${bestTranslationCte}
     SELECT COUNT(*) AS n
     FROM (
       SELECT s.text_raw
       FROM   strings s
       JOIN   bt ON bt.src_string_id = s.id
       WHERE  s.lang = $2
         AND  s.text_raw <> ''
       GROUP  BY s.text_raw
       HAVING COUNT(DISTINCT bt.translation) > 1
     ) x`,
    [targetLang, srcLang],
  );
  const total = Number(countRows[0]?.n ?? 0);

  if (total === 0) return { groups: [], total: 0 };

  const { rows: groupRows } = await db.query<{
    source_text: string;
    variant_count: string;
  }>(
    `WITH ${bestTranslationCte}
     SELECT s.text_raw                         AS source_text,
            COUNT(DISTINCT bt.translation)     AS variant_count
     FROM   strings s
     JOIN   bt ON bt.src_string_id = s.id
     WHERE  s.lang = $2
       AND  s.text_raw <> ''
     GROUP  BY s.text_raw
     HAVING COUNT(DISTINCT bt.translation) > 1
     ORDER  BY variant_count DESC, s.text_raw
     LIMIT  $3 OFFSET $4`,
    [targetLang, srcLang, limit, offset],
  );

  if (groupRows.length === 0) return { groups: [], total };

  const sourceTexts = groupRows.map((r) => r.source_text);
  const { rows: entryRows } = await db.query<CoherenceEntry>(
    `WITH ${bestTranslationCte}
     SELECT s.id             AS string_id,
            s.text_raw       AS source_text,
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
       AND  s.text_raw = ANY($3)
     ORDER  BY s.text_raw, bt.translation, m.name`,
    [targetLang, srcLang, sourceTexts],
  );

  const groupMeta = new Map(
    groupRows.map((r) => [r.source_text, Number(r.variant_count)]),
  );

  const groupMap = new Map<string, CoherenceEntry[]>();
  for (const entry of entryRows) {
    let list = groupMap.get(entry.source_text);
    if (!list) {
      list = [];
      groupMap.set(entry.source_text, list);
    }
    list.push(entry);
  }

  const groups: CoherenceGroup[] = groupRows
    .filter((r) => groupMap.has(r.source_text))
    .map((r) => ({
      source_text: r.source_text,
      variant_count: groupMeta.get(r.source_text) ?? 0,
      entries: groupMap.get(r.source_text) ?? [],
    }));

  return { groups, total };
};

/**
 * Resolves all inconsistencies within a coherence group by applying a single
 * chosen translation to every string that shares the exact source text and
 * currently carries a different translation.
 */
export const resolveCoherenceGroup = async (
  db: Tx,
  sourceText: string,
  targetLang: string,
  chosenTranslation: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ updated: number }> => {
  const { rows } = await db.query<{ string_id: number }>(
    `SELECT s.id AS string_id
     FROM   strings s
     JOIN   translations t ON t.src_string_id = s.id AND t.target_lang = $1
     WHERE  s.lang = $4
       AND  s.text_raw = $2
       AND  t.text <> $3`,
    [targetLang, sourceText, chosenTranslation, srcLang],
  );

  if (rows.length === 0) return { updated: 0 };

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
 */
export const resolveAllCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ resolved: number; updated: number }> => {
  const statusWeight = `CASE status WHEN 'human' THEN 6 WHEN 'reviewed' THEN 5 WHEN 'tm' THEN 4 WHEN 'fuzzy' THEN 3 WHEN 'auto' THEN 2 ELSE 1 END`;

  const { rows: winners } = await db.query<{ source_text: string; translation: string }>(
    `WITH bt AS (
       SELECT
         src_string_id,
         text                  AS translation,
         ${statusWeight}       AS quality
       FROM translations
       WHERE target_lang = $1
     ),
     group_variants AS (
       SELECT s.text_raw         AS source_text,
              bt.translation,
              COUNT(*)::int      AS usage_count,
              MAX(bt.quality)::int AS best_quality
       FROM strings s
       JOIN bt ON bt.src_string_id = s.id
       WHERE s.lang = $2
         AND s.text_raw <> ''
       GROUP BY s.text_raw, bt.translation
     ),
     conflicted AS (
       SELECT source_text
       FROM group_variants
       GROUP BY source_text
       HAVING COUNT(DISTINCT translation) > 1
     ),
     page_winners AS (
       SELECT DISTINCT ON (gv.source_text)
         gv.source_text,
         gv.translation
       FROM group_variants gv
       JOIN conflicted c ON c.source_text = gv.source_text
       ORDER BY gv.source_text, gv.usage_count DESC, gv.best_quality DESC, gv.translation
     )
     SELECT source_text, translation FROM page_winners`,
    [targetLang, srcLang],
  );

  let totalUpdated = 0;
  for (const winner of winners) {
    const result = await resolveCoherenceGroup(
      db,
      winner.source_text,
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
