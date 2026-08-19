import type { Tx } from '../../../db';
import { withPinnedModImportWriteLock } from '../../../import/locks';
import {
  createStringRecordTrgmIndexes,
  dropStringRecordTrgmIndexes,
} from './modsDeleteIndexes';

export type DeleteModDataScope = 'rows' | 'mod';

/** Drop trigram GIN indexes when purging at least this many records. */
export const LARGE_MOD_DELETE_TRGM_DROP_MIN_RECORDS = 10_000;

const deleteChunkSize = (): number => {
  const parsed = Number.parseInt(process.env.DB_CHUNK_SIZE ?? '5000', 10);
  if (!Number.isFinite(parsed) || parsed < 50) return 5000;
  return Math.min(parsed, 20_000);
};

const withBatchTx = async <T>(client: Tx, fn: () => Promise<T>): Promise<T> => {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL synchronous_commit = off');
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
};

const deleteTranslationDependents = async (
  client: Tx,
  stringIds: number[],
  chunk: number,
): Promise<void> => {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM translations WHERE src_string_id = ANY($1::int[])`,
    [stringIds],
  );
  const translationIds = rows.map((row) => row.id);

  // Look up translation ids first. `DELETE … WHERE translation_id IN (SELECT …)`
  // on an empty subquery can seq-scan translation_examples (HNSW, millions of
  // vectors) and the HTTP delete never returns.
  for (let i = 0; i < translationIds.length; i += chunk) {
    const slice = translationIds.slice(i, i + chunk);
    await client.query(`DELETE FROM translation_examples WHERE translation_id = ANY($1::int[])`, [
      slice,
    ]);
  }

  await client.query(`DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[])`, [stringIds]);
  await client.query(`DELETE FROM translation_revisions WHERE src_string_id = ANY($1::int[])`, [
    stringIds,
  ]);
  if (translationIds.length > 0) {
    await client.query(`DELETE FROM translations WHERE id = ANY($1::int[])`, [translationIds]);
  }
};

export const deleteModGraphAndRow = async (client: Tx, uniqueModIds: number[]): Promise<void> => {
  await withBatchTx(client, async () => {
    await client.query(
      `DELETE FROM dialog_scene_actions dsa
        WHERE dsa.scene_id IN (SELECT id FROM dialog_scenes WHERE mod_id = ANY($1::int[]))
           OR dsa.topic_id IN (SELECT id FROM dialog_topics WHERE mod_id = ANY($1::int[]))`,
      [uniqueModIds],
    );
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
  });
};

/**
 * Remove imported rows without FK CASCADE.
 *
 * Each record batch is its own transaction so an HTTP timeout cannot roll the
 * whole purge back to zero. Dependents are deleted via preselected ids so btree
 * indexes are used instead of joining the full translations table.
 *
 * @param scope - `rows` keeps the mod row; `mod` also removes dialog graph + mods.
 */
export const deleteModDataOnClient = async (
  client: Tx,
  uniqueModIds: number[],
  scope: DeleteModDataScope,
): Promise<{ deletedRecords: number }> => {
  const chunk = deleteChunkSize();
  let deletedRecords = 0;

  const { rows: countRows } = await client.query<{ n: string }>(
    `SELECT count(*)::bigint AS n FROM records WHERE mod_id = ANY($1::int[])`,
    [uniqueModIds],
  );
  const recordCount = Number(countRows[0]?.n ?? 0);
  const dropTrgm = recordCount >= LARGE_MOD_DELETE_TRGM_DROP_MIN_RECORDS;
  if (dropTrgm) {
    await dropStringRecordTrgmIndexes(client);
  }

  try {
    for (;;) {
      const { rows: recordRows } = await client.query<{ id: number }>(
        `SELECT id FROM records WHERE mod_id = ANY($1::int[]) LIMIT $2`,
        [uniqueModIds, chunk],
      );
      if (recordRows.length === 0) break;

      const deleted = await withBatchTx(client, async () => {
        const recordIds = recordRows.map((row) => row.id);
        const { rows: stringRows } = await client.query<{ id: number }>(
          `SELECT id FROM strings WHERE record_id = ANY($1::int[])`,
          [recordIds],
        );
        const stringIds = stringRows.map((row) => row.id);
        if (stringIds.length > 0) {
          await deleteTranslationDependents(client, stringIds, chunk);
          await client.query(`DELETE FROM strings WHERE record_id = ANY($1::int[])`, [recordIds]);
        }
        const { rowCount } = await client.query(`DELETE FROM records WHERE id = ANY($1::int[])`, [
          recordIds,
        ]);
        return rowCount ?? recordIds.length;
      });
      deletedRecords += deleted;
    }

    if (scope === 'mod') {
      await deleteModGraphAndRow(client, uniqueModIds);
    }

    return { deletedRecords };
  } finally {
    if (dropTrgm) {
      await createStringRecordTrgmIndexes(client);
    }
  }
};

export const deleteModDataForModIds = async (
  db: Tx,
  modIds: number[],
  scope: DeleteModDataScope,
): Promise<{ deletedRecords: number }> => {
  const uniqueModIds = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueModIds.length === 0) {
    return { deletedRecords: 0 };
  }

  const result = await withPinnedModImportWriteLock(db, (client) =>
    deleteModDataOnClient(client, uniqueModIds, scope),
  );
  return result;
};

/** @see deleteModDataForModIds */
export const deleteModData = async (
  db: Tx,
  modId: number,
  scope: DeleteModDataScope,
): Promise<{ deletedRecords: number }> => deleteModDataForModIds(db, [modId], scope);
