import type { Tx } from '../../../db';
import { withTransaction } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { withPinnedModImportWriteLock } from '../../import/modImportLocks';
import { APPROVED_STATUS_SQL } from '../../services/modLangStats';

// ── Mods ─────────────────────────────────────────────────────────────────────

/**
 * List mods with aggregate translation statistics.
 * @param db        - database connection / transaction
 * @param opts.game       - optional game filter (e.g. 'fo4'); when omitted returns all games
 * @param opts.srcLang    - source language for string counts
 * @param opts.targetLang - target language for translation counts
 */
export const listMods = async (
  db: Tx,
  opts: { game?: string; srcLang?: string; targetLang?: string } = {},
) => {
  const srcLang = opts.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  const whereClause = opts.game ? 'WHERE m.game = $3' : '';
  const params: unknown[] = [srcLang, targetLang];
  if (opts.game) params.push(opts.game);

  const queryMods = () =>
    db.query<{
      id: number;
      name: string;
      abs_path: string;
      version_hash: string;
      game: string;
      nexus_mod_id: number | null;
      nexus_name: string | null;
      nexus_thumbnail: string | null;
      created_at: Date;
      record_count: string;
      string_count: string;
      translated_count: string;
      approved_count: string;
      fuzzy_count: string;
    }>(
      `SELECT
        m.id,
        m.name,
        m.abs_path,
        m.version_hash,
        m.game,
        m.nexus_mod_id,
        m.nexus_name,
        m.nexus_thumbnail,
        m.created_at,
        COALESCE(st.record_count, 0)::bigint AS record_count,
        COALESCE(st.string_count, 0)::bigint AS string_count,
        COALESCE(st.translated_count, 0)::bigint AS translated_count,
        COALESCE(st.approved_count, 0)::bigint AS approved_count,
        COALESCE(st.fuzzy_count, 0)::bigint AS fuzzy_count
       FROM mods m
       LEFT JOIN (
         SELECT
           r.mod_id,
           COUNT(DISTINCT r.id)::bigint AS record_count,
           COUNT(s.id)::bigint AS string_count,
           COUNT(t.id)::bigint AS translated_count,
           COUNT(*) FILTER (WHERE t.status IN ${APPROVED_STATUS_SQL})::bigint AS approved_count,
           COUNT(*) FILTER (WHERE t.status = 'fuzzy')::bigint AS fuzzy_count
         FROM records r
         JOIN strings s ON s.record_id = r.id AND s.lang = $1
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         GROUP BY r.mod_id
       ) st ON st.mod_id = m.id
       ${whereClause}
       ORDER BY m.created_at DESC`,
      params,
    );

  const { rows } = await queryMods();
  return rows;
};

export const getMod = async (db: Tx, id: number) => {
  const { rows } = await db.query(`SELECT * FROM mods WHERE id = $1`, [id]);
  return rows[0];
};

/**
 * Remove imported data for one or more mods without relying on FK CASCADE.
 *
 * PostgreSQL CASCADE on large mods is slow: translation_examples HNSW updates
 * run row-by-row. Records are removed in DB_CHUNK_SIZE batches; dependents are
 * deleted via preselected string ids (index-friendly) instead of joining the
 * full translations table.
 *
 * @param scope - `rows` keeps mod rows; `mod` also removes dialog graph + mods.
 */
const deleteModDataOnClient = async (
  client: Tx,
  uniqueModIds: number[],
  scope: 'rows' | 'mod',
): Promise<{ deletedRecords: number }> => {
  const CHUNK = CONFIG.dbChunkSize;
  const TE_CHUNK = CONFIG.dbChunkSize;
  let deletedRecords = 0;

  await client.query('BEGIN');
  try {
    /*
     * Purge records in batches. A single DELETE … USING strings JOIN records
     * makes PostgreSQL seq-scan all translations (~millions of rows) even when
     * only one mod is removed. Collect string ids per record batch and delete
     * dependents via src_string_id = ANY(…) so btree indexes are used instead.
     */
    for (;;) {
      const { rows: recordRows } = await client.query<{ id: number }>(
        `SELECT id FROM records WHERE mod_id = ANY($1::int[]) LIMIT $2`,
        [uniqueModIds, CHUNK],
      );
      if (recordRows.length === 0) break;

      const recordIds = recordRows.map((r) => r.id);
      const { rows: stringRows } = await client.query<{ id: number }>(
        `SELECT id FROM strings WHERE record_id = ANY($1::int[])`,
        [recordIds],
      );
      const stringIds = stringRows.map((r) => r.id);

      if (stringIds.length > 0) {
        for (;;) {
          const { rowCount } = await client.query(
            `DELETE FROM translation_examples te
              WHERE te.translation_id IN (
                SELECT t.id FROM translations t
                 WHERE t.src_string_id = ANY($1::int[])
                 LIMIT $2
              )`,
            [stringIds, TE_CHUNK],
          );
          if (!rowCount || rowCount < TE_CHUNK) break;
        }

        await client.query(`DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[])`, [
          stringIds,
        ]);
        await client.query(`DELETE FROM translation_revisions WHERE src_string_id = ANY($1::int[])`, [
          stringIds,
        ]);
        await client.query(`DELETE FROM translations WHERE src_string_id = ANY($1::int[])`, [
          stringIds,
        ]);
      }

      await client.query(`DELETE FROM strings WHERE record_id = ANY($1::int[])`, [recordIds]);
      const { rowCount } = await client.query(`DELETE FROM records WHERE id = ANY($1::int[])`, [
        recordIds,
      ]);
      deletedRecords += rowCount ?? recordIds.length;
    }

    if (scope === 'mod') {
      await client.query(
        `DELETE FROM dialog_scene_phases dsp
          WHERE dsp.scene_id IN (SELECT id FROM dialog_scenes WHERE mod_id = ANY($1::int[]))
             OR dsp.topic_id IN (SELECT id FROM dialog_topics WHERE mod_id = ANY($1::int[]))`,
        [uniqueModIds],
      );
      await client.query(
        `DELETE FROM dialog_edges de
          USING dialog_topics dt
         WHERE de.topic_id = dt.id
           AND dt.mod_id = ANY($1::int[])`,
        [uniqueModIds],
      );
      await client.query(
        `DELETE FROM dialog_nodes dn
          USING dialog_topics dt
         WHERE dn.topic_id = dt.id
           AND dt.mod_id = ANY($1::int[])`,
        [uniqueModIds],
      );
      await client.query(`DELETE FROM dialog_scenes WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM dialog_topics WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM dialog_branches WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM dialog_quests WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM mods WHERE id = ANY($1::int[])`, [uniqueModIds]);
    }

    await client.query('COMMIT');
    return { deletedRecords };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
};

export const deleteModDataForModIds = async (
  db: Tx,
  modIds: number[],
  scope: 'rows' | 'mod',
): Promise<{ deletedRecords: number }> => {
  const uniqueModIds = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueModIds.length === 0) {
    return { deletedRecords: 0 };
  }

  const started = Date.now();

  const result = await withPinnedModImportWriteLock(db, (client) =>
    deleteModDataOnClient(client, uniqueModIds, scope),
  );

  log.info(
    `deleteModData modIds=${uniqueModIds.join(',')} scope=${scope} records=${result.deletedRecords} ms=${Date.now() - started}`,
  );
  return result;
};

/** @see deleteModDataForModIds */
export const deleteModData = async (
  db: Tx,
  modId: number,
  scope: 'rows' | 'mod',
): Promise<{ deletedRecords: number }> => deleteModDataForModIds(db, [modId], scope);

/**
 * Languages actually present on a mod (source `strings` + target `translations`).
 * Used by apply-from-mod and editor language pickers.
 */
export const listModLangs = async (db: Tx, modId: number): Promise<string[]> => {
  const { rows } = await db.query<{ lang: string }>(
    `SELECT DISTINCT lang FROM (
       SELECT s.lang
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL
       UNION
       SELECT t.target_lang AS lang
       FROM translations t
       JOIN strings s ON t.src_string_id = s.id
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1
     ) langs
     ORDER BY lang`,
    [modId],
  );
  return rows.map((r) => r.lang);
};
