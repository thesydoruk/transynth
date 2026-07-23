import type { Tx } from '../../../db';
import type pg from 'pg';
import { withTransaction } from '../../../db';
import { CONFIG } from '../../../config';
import { recordTranslationRevision } from '../translationRevisions';
import { type StringsFilter, buildStringFilterConditions } from './stringsFilter';

export const deleteTranslation = async (
  db: Tx,
  stringId: number,
  targetLang = CONFIG.defaultTgtLang,
) => {
  const { rows } = await db.query<{
    id: number;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT id, text, provenance, model
       FROM translations
      WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  for (const row of rows) {
    await recordTranslationRevision(db, {
      stringId,
      translationId: row.id,
      targetLang,
      text: row.text,
      status: 'deleted',
      provenance: row.provenance,
      model: row.model,
      note: 'clear',
    });
  }

  if (rows.length > 0) {
    await db.query(`DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2`, [
      stringId,
      targetLang,
    ]);
  }

  await db.query(`DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2`, [
    stringId,
    targetLang,
  ]);

  return { removed: rows.length };
};

/** Archive revisions, drop translations, and drop QA rows — three statements, no per-row work. */
const clearTranslationsInTransaction = async (
  client: pg.PoolClient,
  targetLang: string,
  targetStringsSql: string,
  values: unknown[],
): Promise<number> => {
  const { rowCount } = await client.query(
    `INSERT INTO translation_revisions(
       src_string_id, translation_id, target_lang, text, status, provenance, model, note
     )
     SELECT t.src_string_id, t.id, t.target_lang, t.text, 'deleted', t.provenance, t.model, 'clear'
       FROM translations t
      WHERE t.target_lang = $1
        AND t.src_string_id IN (${targetStringsSql})`,
    values,
  );
  await client.query(
    `DELETE FROM translations t
      WHERE t.target_lang = $1
        AND t.src_string_id IN (${targetStringsSql})`,
    values,
  );
  await client.query(
    `DELETE FROM qa_issues qi
      WHERE qi.target_lang = $1
        AND qi.src_string_id IN (${targetStringsSql})`,
    values,
  );
  return rowCount ?? 0;
};

/** Remove target-language translations for many source strings at once. */
export const deleteTranslationsBatch = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ removed: number }> => {
  if (stringIds.length === 0) return { removed: 0 };

  const removed = await withTransaction(db as pg.Pool, async (client) =>
    clearTranslationsInTransaction(client, targetLang, 'SELECT unnest($2::int[])', [
      targetLang,
      stringIds,
    ]),
  );
  return { removed };
};

/** Shift $1, $2, … placeholders in SQL fragments (used when prepending a bound param). */
const bumpSqlParams = (sql: string, by = 1): string =>
  sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + by}`);

/**
 * Remove target-language translations for every string matching an editor filter.
 * Avoids fetching the full ID list to the client first.
 */
export const deleteTranslationsByFilter = async (
  db: Tx,
  f: StringsFilter,
  excludeIds: number[] = [],
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ removed: number }> => {
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const { conditions, values, idx } = buildStringFilterConditions(f);
  // clearTranslationsInTransaction binds targetLang as $1; filter params follow from $2.
  const where = bumpSqlParams(conditions.join(' AND '));
  const targetLangIdx = idx + 1;
  const srcLangIdx = idx + 2;
  const queryValues: unknown[] = [targetLang, ...values, targetLang, srcLang];

  let excludeIdx: number | null = null;
  if (excludeIds.length > 0) {
    excludeIdx = srcLangIdx + 1;
    queryValues.push(excludeIds);
  }

  const qaExists = `EXISTS (SELECT 1 FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${targetLangIdx} AND qi.is_active = TRUE)`;
  const excludeClause = excludeIdx != null ? ` AND s.id <> ALL($${excludeIdx}::int[])` : '';

  const targetStringsSql = `SELECT s.id
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
      WHERE s.lang = $${srcLangIdx} AND ${where}${f.qaOnly ? ` AND ${qaExists}` : ''}${excludeClause}`;

  const removed = await withTransaction(db as pg.Pool, async (client) =>
    clearTranslationsInTransaction(client, targetLang, targetStringsSql, queryValues),
  );
  return { removed };
};

/**
 * Remove target-language translations where trimmed text equals trimmed source.
 * Used to clean up accidental copy-source / untranslated rows across a mod.
 */
export const clearSameAsSourceTranslations = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ cleared: number }> => {
  const { rows } = await db.query<{
    string_id: number;
    translation_id: number;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT s.id AS string_id, t.id AS translation_id, t.text, t.provenance, t.model
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND trim(s.text_raw) = trim(t.text)
        AND length(trim(s.text_raw)) > 0`,
    [modId, srcLang, targetLang],
  );

  if (rows.length === 0) return { cleared: 0 };

  const stringIds = rows.map((row) => row.string_id);

  await withTransaction(db as pg.Pool, async (client) => {
    for (const row of rows) {
      await recordTranslationRevision(client, {
        stringId: row.string_id,
        translationId: row.translation_id,
        targetLang,
        text: row.text,
        status: 'deleted',
        provenance: row.provenance,
        model: row.model,
        note: 'clear_same_as_source',
      });
    }
    await client.query(
      `DELETE FROM translations
        WHERE target_lang = $1
          AND src_string_id = ANY($2::int[])`,
      [targetLang, stringIds],
    );
    await client.query(
      `DELETE FROM qa_issues
        WHERE target_lang = $1
          AND src_string_id = ANY($2::int[])`,
      [targetLang, stringIds],
    );
  });

  return { cleared: rows.length };
};
