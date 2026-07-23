import type { Tx } from '../../../db';
import { withPgRetry } from '../../../db';
import { CONFIG } from '../../../config';
import { bulkRecordTranslationRevisions } from '../../data/translationRevisions';
import type { TranslationStatus } from '../../data/statusMachine';
import { chunk } from './chunk';
import type { BulkTranslationRow, SqlConvertImportTranslationsResult } from './types';

/** Deduplicate by src_string_id (last text wins) before bulk insert. */
export const dedupeBulkTranslationRows = (items: BulkTranslationRow[]): BulkTranslationRow[] => {
  const byId = new Map<number, string>();
  for (const item of items) byId.set(item.srcStringId, item.text);
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
 * SQL expression matching {@link alignmentKeyedStrings} in modImportService.
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

  const alignKey = stringAlignKeySql('s');
  const modStringsCte = `mod_strings AS (
    SELECT
      s.id,
      s.lang,
      s.text_raw,
      ${alignKey} AS align_key
    FROM strings s
    INNER JOIN records r ON r.id = s.record_id
    WHERE r.mod_id = $1
  )`;

  const skippedResult = await db.query<{ count: string }>(
    `WITH ${modStringsCte},
     source_keys AS (
       SELECT align_key FROM mod_strings WHERE lang = $2
     )
     SELECT COUNT(*)::text AS count
     FROM mod_strings tgt
     WHERE tgt.lang != $2
       AND NOT EXISTS (
         SELECT 1 FROM source_keys sk WHERE sk.align_key = tgt.align_key
       )`,
    [modId, resolvedSourceLocale],
  );
  const skippedWithoutSource = Number.parseInt(skippedResult.rows[0]?.count ?? '0', 10);

  const sourceCountResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND s.lang = $2`,
    [modId, resolvedSourceLocale],
  );
  const sourceStringCount = Number.parseInt(sourceCountResult.rows[0]?.count ?? '0', 10);
  if (sourceStringCount === 0) {
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

  const { rowCount } = await db.query(
    `WITH ${modStringsCte},
     source_strings AS (
       SELECT id, align_key FROM mod_strings WHERE lang = $2
     )
     INSERT INTO translations(
       src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
     )
     SELECT
       src.id,
       tgt.lang,
       tgt.text_raw,
       'reviewed',
       1.0,
       'import_self_translation',
       NULL,
       NULL,
       NOW()
     FROM source_strings src
     INNER JOIN mod_strings tgt ON tgt.align_key = src.align_key`,
    [modId, resolvedSourceLocale],
  );

  return {
    inserted: rowCount ?? 0,
    skippedWithoutSource,
    locales,
    resolvedSourceLocale,
  };
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
