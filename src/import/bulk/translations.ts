import type { Tx } from '../../db';
import { withPgRetry } from '../../db';
import { CONFIG } from '../../config';
import { normalizeAutoTranslationQuotes } from '../../utils/textNorm';
import { bulkRecordTranslationRevisions } from '../../web/data/translationRevisions';
import type { TranslationStatus } from '../../web/data/statusMachine';
import { chunk } from './chunk';
import type { BulkTranslationRow, SqlConvertImportTranslationsResult } from './types';

/** Deduplicate by src_string_id (last text wins) before bulk insert. */
export const dedupeBulkTranslationRows = (items: BulkTranslationRow[]): BulkTranslationRow[] => {
  const byId = new Map<number, string>();
  for (const item of items) byId.set(item.srcStringId, normalizeAutoTranslationQuotes(item.text));
  return [...byId.entries()].map(([srcStringId, text]) => ({ srcStringId, text }));
};

/** Fast translation upsert (no QA or RAG). Optionally records revision history. */
const bulkUpsertTranslationsCore = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  provenance: string,
  status: string,
  batchSize: number,
  model: string | null,
  revisionNote?: string | null,
): Promise<number> => {
  const deduped = dedupeBulkTranslationRows(items);
  let total = 0;
  for (const part of chunk(deduped, batchSize)) {
    if (part.length === 0) continue;
    const stringIds = part.map((p) => p.srcStringId);
    const texts = part.map((p) => p.text);
    await withPgRetry(
      async () => {
        await db.query(
          `DELETE FROM translations WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
          [stringIds, targetLang],
        );
        const { rows: inserted } = await db.query<{
          id: number;
          src_string_id: number;
          text: string;
          status: string;
          provenance: string | null;
        }>(
          `INSERT INTO translations(
             src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
           )
           SELECT s, $3, t, $5, 1.0, $4, $6, NULL, NOW()
           FROM UNNEST($1::int[], $2::text[]) AS u(s, t)
           RETURNING id, src_string_id, text, status, provenance`,
          [stringIds, texts, targetLang, provenance, status, model],
        );

        if (revisionNote) {
          await bulkRecordTranslationRevisions(
            db,
            inserted.map((row) => ({
              stringId: row.src_string_id,
              translationId: row.id,
              targetLang,
              text: row.text,
              status: status as TranslationStatus,
              provenance: row.provenance,
              model,
              note: revisionNote,
            })),
          );
        }
      },
      { label: 'bulkUpsertTranslations' },
    );

    total += part.length;
  }
  return total;
};

/**
 * SQL expression matching {@link alignmentKeyedStrings}.
 * Expects `strings` columns: id, record_id, lang, lstring_id.
 */
export const stringAlignKeySql = (alias = 's'): string => {
  const a = alias;
  return `CASE
    WHEN ${a}.lstring_id IS NOT NULL THEN ${a}.record_id::text || ':L' || ${a}.lstring_id::text
    ELSE ${a}.record_id::text || ':P' || (
      SUM(CASE WHEN ${a}.lstring_id IS NULL THEN 1 ELSE 0 END) OVER (
        PARTITION BY ${a}.record_id, ${a}.lang
        ORDER BY ${a}.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) - 1
    )::text
  END`;
};

const TRANSLATION_INSERT_COLS = `INSERT INTO translations(
  src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
)`;

const TRANSLATION_INSERT_VALUES = `SELECT
  src.id,
  tgt.lang,
  tgt.text_raw,
  'reviewed',
  1.0,
  'import_self_translation',
  NULL,
  NULL,
  NOW()`;

/** Official plugins pair locales by lstring id — integer join, no window. */
export const SQL_CONVERT_LSTRING_INSERT = `${TRANSLATION_INSERT_COLS}
${TRANSLATION_INSERT_VALUES}
FROM strings src
INNER JOIN records r ON r.id = src.record_id
INNER JOIN strings tgt
  ON tgt.record_id = src.record_id
 AND tgt.lstring_id = src.lstring_id
WHERE r.mod_id = $1
  AND src.lang = $2
  AND src.lstring_id IS NOT NULL`;

/**
 * Inline (no lstring) rows only. Window stays here so MCM / Interface txt still
 * pair by position; official FO4 INFO/TES4 strings never enter this CTE.
 */
export const SQL_CONVERT_INLINE_INSERT = `WITH inline_strings AS (
  SELECT
    s.id,
    s.lang,
    s.text_raw,
    s.record_id,
    (ROW_NUMBER() OVER (
      PARTITION BY s.record_id, s.lang
      ORDER BY s.id
    ) - 1) AS ordinal
  FROM strings s
  INNER JOIN records r ON r.id = s.record_id
  WHERE r.mod_id = $1 AND s.lstring_id IS NULL
)
${TRANSLATION_INSERT_COLS}
${TRANSLATION_INSERT_VALUES}
FROM inline_strings src
INNER JOIN inline_strings tgt
  ON tgt.record_id = src.record_id
 AND tgt.ordinal = src.ordinal
WHERE src.lang = $2`;

const toCount = (value: string | null | undefined): number => Number.parseInt(value ?? '0', 10);

const withConvertTx = async <T>(db: Tx, fn: () => Promise<T>): Promise<T> => {
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL work_mem = '256MB'");
    await db.query('SET LOCAL synchronous_commit = off');
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
};

/**
 * Build translations from imported locale strings via SQL alignment join.
 * Avoids loading all strings into Node for large multi-locale mods.
 */
export const sqlConvertImportedStringsToTranslations = async (
  db: Tx,
  modId: number,
  resolvedSourceLocale: string,
): Promise<SqlConvertImportTranslationsResult> => {
  const localesResult = await db.query<{ lang: string }>(
    `SELECT DISTINCT s.lang
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND s.lang IS NOT NULL`,
    [modId],
  );
  const locales = localesResult.rows.map((r) => r.lang).filter(Boolean);
  if (locales.length === 0) {
    return { inserted: 0, skippedWithoutSource: 0, locales: [], resolvedSourceLocale };
  }

  return withConvertTx(db, async () => {
    const sourceCountResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang = $2`,
      [modId, resolvedSourceLocale],
    );
    if (toCount(sourceCountResult.rows[0]?.count) === 0) {
      throw new Error(`Source locale "${resolvedSourceLocale}" not found for mod ${modId}`);
    }

    await db.query(
      `DELETE FROM translations t
       USING strings s
       JOIN records r ON r.id = s.record_id
       WHERE t.src_string_id = s.id
         AND r.mod_id = $1
         AND s.lang = $2`,
      [modId, resolvedSourceLocale],
    );

    const lstringInsert = await db.query(SQL_CONVERT_LSTRING_INSERT, [modId, resolvedSourceLocale]);
    const inlineInsert = await db.query(SQL_CONVERT_INLINE_INSERT, [modId, resolvedSourceLocale]);

    const skippedResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM strings tgt
       INNER JOIN records r ON r.id = tgt.record_id
       WHERE r.mod_id = $1
         AND tgt.lang IS DISTINCT FROM $2
         AND tgt.lstring_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM strings src
           WHERE src.record_id = tgt.record_id
             AND src.lstring_id = tgt.lstring_id
             AND src.lang = $2
         )`,
      [modId, resolvedSourceLocale],
    );

    return {
      inserted: (lstringInsert.rowCount ?? 0) + (inlineInsert.rowCount ?? 0),
      skippedWithoutSource: toCount(skippedResult.rows[0]?.count),
      locales,
      resolvedSourceLocale,
    };
  });
};

/** Fast translation upsert for import pipelines (no RAG, revision, or QA). */
export const bulkUpsertImportTranslations = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  provenance: string,
  batchSize = CONFIG.dbChunkSize,
  status = 'reviewed',
): Promise<number> =>
  bulkUpsertTranslationsCore(db, items, targetLang, provenance, status, batchSize, null);

/**
 * Bulk upsert for LLM auto-translate. Records revision history; QA runs asynchronously.
 */
export const bulkUpsertAutoTranslations = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  model: string,
  batchSize = 1000,
): Promise<number> =>
  bulkUpsertTranslationsCore(
    db,
    items,
    targetLang,
    'auto_generated',
    'auto',
    batchSize,
    model,
    'llm',
  );
