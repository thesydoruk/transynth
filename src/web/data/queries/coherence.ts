import type { Tx } from '../../../db';
import type pg from 'pg';
import { withTransaction } from '../../../db';
import { CONFIG } from '../../../config';
import { upsertTranslation } from './translationsUpsert';

// ── Coherence checking ────────────────────────────────────────────────────────

/**
 * A single string entry within a coherence group.
 * Represents one source string whose translation differs from at least one
 * other string that shares the same exact source text and record signature.
 */
export type CoherenceEntry = {
  string_id: number;
  /** Exact source text — part of the group key. */
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
 * A coherence group — strings sharing the same exact source text and
 * record signature that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  /** Exact source text that identifies this group. */
  source_text: string;
  /** Record signature (GRUP) scoped with source_text — e.g. INFO, UI, ARMO. */
  signature: string;
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

const groupKey = (sourceText: string, signature: string): string =>
  `${sourceText}\0${signature}`;

/**
 * Returns a paginated coherence report — groups of source strings that share
 * the same exact `text_raw` and record `signature` but have inconsistent
 * translations. UI vs dialog (and other GRUPs) are separate groups.
 */
export const getCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  limit = 50,
  offset = 0,
  srcLang = CONFIG.defaultSrcLang,
  game?: string,
): Promise<CoherenceResult> => {
  const gameFilter = game ?? null;
  const { rows: countRows } = await db.query<{ n: string }>(
    `WITH ${bestTranslationCte}
     SELECT COUNT(*) AS n
     FROM (
       SELECT s.text_raw, COALESCE(r.signature, '') AS signature
       FROM   strings s
       JOIN   bt ON bt.src_string_id = s.id
       JOIN   records r ON r.id = s.record_id
       JOIN   mods m ON m.id = r.mod_id
       WHERE  s.lang = $2
         AND  s.text_raw <> ''
         AND  ($3::text IS NULL OR m.game = $3)
       GROUP  BY s.text_raw, COALESCE(r.signature, '')
       HAVING COUNT(DISTINCT bt.translation) > 1
     ) x`,
    [targetLang, srcLang, gameFilter],
  );
  const total = Number(countRows[0]?.n ?? 0);

  if (total === 0) return { groups: [], total: 0 };

  const { rows: groupRows } = await db.query<{
    source_text: string;
    signature: string;
    variant_count: string;
  }>(
    `WITH ${bestTranslationCte}
     SELECT s.text_raw                         AS source_text,
            COALESCE(r.signature, '')          AS signature,
            COUNT(DISTINCT bt.translation)     AS variant_count
     FROM   strings s
     JOIN   bt ON bt.src_string_id = s.id
     JOIN   records r ON r.id = s.record_id
     JOIN   mods m ON m.id = r.mod_id
     WHERE  s.lang = $2
       AND  s.text_raw <> ''
       AND  ($5::text IS NULL OR m.game = $5)
     GROUP  BY s.text_raw, COALESCE(r.signature, '')
     HAVING COUNT(DISTINCT bt.translation) > 1
     ORDER  BY variant_count DESC, s.text_raw, COALESCE(r.signature, '')
     LIMIT  $3 OFFSET $4`,
    [targetLang, srcLang, limit, offset, gameFilter],
  );

  if (groupRows.length === 0) return { groups: [], total };

  const sourceTexts = groupRows.map((r) => r.source_text);
  const signatures = groupRows.map((r) => r.signature);
  const { rows: entryRows } = await db.query<CoherenceEntry>(
    `WITH ${bestTranslationCte}
     SELECT s.id             AS string_id,
            s.text_raw       AS source_text,
            r.edid,
            COALESCE(r.signature, '') AS signature,
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
     JOIN   UNNEST($3::text[], $4::text[]) AS g(source_text, signature)
       ON   s.text_raw = g.source_text
      AND   COALESCE(r.signature, '') = g.signature
     WHERE  s.lang = $2
       AND  ($5::text IS NULL OR m.game = $5)
     ORDER  BY s.text_raw, COALESCE(r.signature, ''), bt.translation, m.name`,
    [targetLang, srcLang, sourceTexts, signatures, gameFilter],
  );

  const groupMeta = new Map(
    groupRows.map((r) => [
      groupKey(r.source_text, r.signature),
      { source_text: r.source_text, signature: r.signature, variant_count: Number(r.variant_count) },
    ]),
  );

  const groupMap = new Map<string, CoherenceEntry[]>();
  for (const entry of entryRows) {
    const key = groupKey(entry.source_text, entry.signature);
    let list = groupMap.get(key);
    if (!list) {
      list = [];
      groupMap.set(key, list);
    }
    list.push(entry);
  }

  const groups: CoherenceGroup[] = groupRows
    .map((r) => groupKey(r.source_text, r.signature))
    .filter((key) => groupMap.has(key))
    .map((key) => {
      const meta = groupMeta.get(key)!;
      return {
        source_text: meta.source_text,
        signature: meta.signature,
        variant_count: meta.variant_count,
        entries: groupMap.get(key) ?? [],
      };
    });

  return { groups, total };
};

/**
 * Resolves inconsistencies within one coherence group (same exact source text
 * and record signature) by applying a chosen translation to differing strings.
 */
export const resolveCoherenceGroup = async (
  db: Tx,
  sourceText: string,
  signature: string,
  targetLang: string,
  chosenTranslation: string,
  srcLang = CONFIG.defaultSrcLang,
  game?: string,
): Promise<{ updated: number }> => {
  const { rows } = await db.query<{ string_id: number }>(
    `SELECT s.id AS string_id
     FROM   strings s
     JOIN   records r ON r.id = s.record_id
     JOIN   mods m ON m.id = r.mod_id
     JOIN   translations t ON t.src_string_id = s.id AND t.target_lang = $1
     WHERE  s.lang = $5
       AND  s.text_raw = $2
       AND  COALESCE(r.signature, '') = $3
       AND  t.text <> $4
       AND  ($6::text IS NULL OR m.game = $6)`,
    [targetLang, sourceText, signature, chosenTranslation, srcLang, game ?? null],
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
