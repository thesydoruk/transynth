import type { Tx } from '../../../db';
import { mcmKeyFromRecordPath } from '../../../formats/mcm';

/** `$key` → source text for every MCM row in the same mod(s) as `stringIds`. */
export const loadMcmSiblingTextsByStringIds = async (
  db: Tx,
  stringIds: number[],
  srcLang: string,
): Promise<Map<string, string>> => {
  if (stringIds.length === 0) return new Map();
  const { rows } = await db.query<{ path: string; text_raw: string }>(
    `SELECT r.path, s.text_raw
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.signature = 'MCM'
        AND s.lang = $2
        AND r.mod_id IN (
          SELECT r2.mod_id
            FROM strings s2
            JOIN records r2 ON r2.id = s2.record_id
           WHERE s2.id = ANY($1::int[])
        )`,
    [stringIds, srcLang],
  );
  return mcmSiblingMapFromRows(rows);
};

/** `$key` → source text for every MCM row of one mod. */
export const loadMcmSiblingTextsByModId = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ path: string; text_raw: string }>(
    `SELECT r.path, s.text_raw
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND r.signature = 'MCM'
        AND s.lang = $2`,
    [modId, srcLang],
  );
  return mcmSiblingMapFromRows(rows);
};

const mcmSiblingMapFromRows = (rows: Array<{ path: string; text_raw: string }>): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = mcmKeyFromRecordPath(row.path);
    if (key) map.set(key, row.text_raw);
  }
  return map;
};
