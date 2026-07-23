import type { Tx } from '../../../db';
import { chunk } from './chunk';
import { parseModImportRecordKey } from './recordKeys';
import type { PruneStaleModImportResult } from './types';

const PRUNE_TEMP_BATCH = 5000;

/**
 * Remove strings/records for a mod that were not part of the latest full import.
 * Keeps only rows whose ids/keys were collected while ingesting from offset 0.
 */
export const pruneStaleModImportData = async (
  db: Tx,
  modId: number,
  keptRecordKeys: ReadonlySet<string>,
  keptStringIds: ReadonlySet<number>,
): Promise<PruneStaleModImportResult> => {
  await db.query('BEGIN');
  try {
    await db.query(`CREATE TEMP TABLE _import_kept_strings (id int PRIMARY KEY) ON COMMIT DROP`);
    await db.query(
      `CREATE TEMP TABLE _import_kept_records (
         signature text NOT NULL,
         path text NOT NULL,
         formid_hex text NOT NULL,
         PRIMARY KEY (signature, path, formid_hex)
       ) ON COMMIT DROP`,
    );

    for (const part of chunk([...keptStringIds], PRUNE_TEMP_BATCH)) {
      await db.query(`INSERT INTO _import_kept_strings SELECT unnest($1::int[])`, [part]);
    }

    const recordRows = [...keptRecordKeys].map(parseModImportRecordKey);
    for (const part of chunk(recordRows, PRUNE_TEMP_BATCH)) {
      await db.query(
        `INSERT INTO _import_kept_records(signature, path, formid_hex)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])`,
        [part.map((r) => r.signature), part.map((r) => r.path), part.map((r) => r.formId)],
      );
    }

    await db.query(
      `UPDATE dialog_nodes dn
          SET response_string_id = NULL
         FROM strings s
         JOIN records r ON s.record_id = r.id
        WHERE dn.response_string_id = s.id
          AND r.mod_id = $1
          AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    await db.query(
      `DELETE FROM translation_examples te
        USING translations t
        JOIN strings s ON t.src_string_id = s.id
        JOIN records r ON s.record_id = r.id
       WHERE te.translation_id = t.id
         AND r.mod_id = $1
         AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    await db.query(
      `DELETE FROM qa_issues qi
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE qi.src_string_id = s.id
         AND r.mod_id = $1
         AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    await db.query(
      `DELETE FROM translation_revisions tr
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE tr.src_string_id = s.id
         AND r.mod_id = $1
         AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    await db.query(
      `DELETE FROM translations t
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE t.src_string_id = s.id
         AND r.mod_id = $1
         AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    const { rowCount: deletedStrings } = await db.query(
      `DELETE FROM strings s
        USING records r
       WHERE s.record_id = r.id
         AND r.mod_id = $1
         AND NOT EXISTS (SELECT 1 FROM _import_kept_strings k WHERE k.id = s.id)`,
      [modId],
    );

    const { rowCount: deletedRecords } = await db.query(
      `DELETE FROM records r
       WHERE r.mod_id = $1
         AND (
           NOT EXISTS (
             SELECT 1
               FROM _import_kept_records k
              WHERE k.signature = r.signature
                AND k.path = r.path
                AND k.formid_hex = r.formid_hex
           )
           OR NOT EXISTS (SELECT 1 FROM strings s WHERE s.record_id = r.id)
         )`,
      [modId],
    );

    await db.query('COMMIT');
    return {
      deletedStrings: deletedStrings ?? 0,
      deletedRecords: deletedRecords ?? 0,
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
};
