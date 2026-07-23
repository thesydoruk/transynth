import type { Tx } from '../../../db';
import { recordTranslationRevision } from '../translationRevisions';

/** Remove every translation row (all target languages) for one source string. */
export const deleteAllTranslationsForString = async (db: Tx, stringId: number): Promise<number> => {
  const { rows } = await db.query<{
    id: number;
    target_lang: string;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT id, target_lang, text, provenance, model
       FROM translations
      WHERE src_string_id = $1`,
    [stringId],
  );

  for (const row of rows) {
    await recordTranslationRevision(db, {
      stringId,
      translationId: row.id,
      targetLang: row.target_lang,
      text: row.text,
      status: 'deleted',
      provenance: row.provenance,
      model: row.model,
      note: 'clear',
    });
  }

  if (rows.length > 0) {
    await db.query(`DELETE FROM translations WHERE src_string_id = $1`, [stringId]);
  }

  await db.query(`DELETE FROM qa_issues WHERE src_string_id = $1`, [stringId]);

  return rows.length;
};

/**
 * Mark source string(s) as non-translatable.
 *
 * The `is_ignored` flag is the single source of truth for the "skip" status
 * (listStrings derives `status = 'skip'` from it, stats count it as skipped,
 * and the status filter maps `skip` → `is_ignored = TRUE`). A non-translatable
 * string must not carry any translation rows, so all existing translations
 * (every target language) are deleted here. Export still emits the source text
 * via `COALESCE(t.text, s.text_raw)` once translations are gone.
 *
 */
export const markStringsAsSkip = async (db: Tx, stringIds: number[]): Promise<number> => {
  if (stringIds.length === 0) return 0;

  const { rows } = await db.query<{ id: number }>(
    `UPDATE strings SET is_ignored = TRUE
      WHERE id = ANY($1::int[])
        AND is_ignored = FALSE
      RETURNING id`,
    [stringIds],
  );

  const markedIds = rows.map((row) => row.id);
  if (markedIds.length === 0) return 0;

  if (markedIds.length === 1) {
    await deleteAllTranslationsForString(db, markedIds[0]!);
    return 1;
  }

  await db.query(`DELETE FROM translations WHERE src_string_id = ANY($1::int[])`, [markedIds]);
  await db.query(`DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[])`, [markedIds]);

  return markedIds.length;
};

/** Clear skip flags and audit timestamps for a mod before a force re-scan. */
export const resetModSkipDetectState = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<{ resetCount: number; clearedSkips: number }> => {
  const { rows: before } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = TRUE`,
    [modId, srcLang],
  );
  const clearedSkips = Number.parseInt(before[0]?.cnt ?? '0', 10);

  const { rowCount } = await db.query(
    `UPDATE strings s
        SET is_ignored = FALSE,
            skip_detect_scanned_at = NULL
       FROM records r
      WHERE r.id = s.record_id
        AND r.mod_id = $1
        AND s.lang = $2`,
    [modId, srcLang],
  );

  return { resetCount: rowCount ?? 0, clearedSkips };
};

/** Clear the global skip flag so the string(s) can be translated again. */
export const unmarkStringsSkip = async (db: Tx, stringIds: number[]): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE strings SET is_ignored = FALSE WHERE id = ANY($1::int[])`,
    [stringIds],
  );
  return rowCount ?? 0;
};

/** Record that skip-detect has audited these source strings (keep or skip verdict). */
export const markStringsSkipDetectScanned = async (
  db: Tx,
  stringIds: number[],
): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE strings
        SET skip_detect_scanned_at = NOW()
      WHERE id = ANY($1::int[])`,
    [stringIds],
  );
  return rowCount ?? 0;
};
