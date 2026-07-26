import type { Tx } from '../../../db';
import type { NarratorGender, NarratorGenderSource } from '../../../dialog/narratorGender';

export type GenderDetectRecordRow = {
  record_id: number;
  signature: string;
  path: string;
  edid: string | null;
  formid_hex: string;
  source_excerpt: string;
};

export type GenderDetectWorkUnit = {
  page: number;
  chunk: readonly GenderDetectRecordRow[];
};

const narrativeFilterSql = `
  r.signature IN ('BOOK', 'TERM', 'NOTE')
  AND (
    r.path ILIKE '%\\UNAM' OR r.path ILIKE '%\\DESC' OR r.path ILIKE '%\\CNAM'
  )`;

const pendingFilterSql = (force: boolean): string =>
  force ? '' : 'AND r.gender_detect_scanned_at IS NULL';

export const countGenderDetectRecords = async (
  db: Tx,
  modId: number,
  srcLang: string,
  force: boolean,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(DISTINCT r.id)::text AS cnt
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
      WHERE r.mod_id = $1
        AND s.is_ignored = FALSE
        AND ${narrativeFilterSql}
        ${pendingFilterSql(force)}`,
    [modId, srcLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

const loadRecordChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  afterId: number,
  limit: number,
  force: boolean,
): Promise<GenderDetectRecordRow[]> => {
  const { rows } = await db.query<GenderDetectRecordRow>(
    `SELECT DISTINCT ON (r.id)
            r.id AS record_id,
            r.signature,
            r.path,
            r.edid,
            r.formid_hex,
            LEFT(s.text_raw, 2000) AS source_excerpt
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $3
      WHERE r.mod_id = $1
        AND r.id > $2
        AND s.is_ignored = FALSE
        AND ${narrativeFilterSql}
        ${pendingFilterSql(force)}
      ORDER BY r.id, length(s.text_raw) DESC
      LIMIT $4`,
    [modId, afterId, srcLang, limit],
  );
  return rows;
};

export async function* iterateGenderDetectWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    force: boolean;
    dbChunkSize?: number;
    processBatchSize?: number;
  },
): AsyncGenerator<GenderDetectWorkUnit> {
  let afterId = 0;
  let page = 0;
  const dbChunkSize = Math.max(20, opts.dbChunkSize ?? 200);
  const processBatchSize = opts.processBatchSize;

  let nextChunkPromise = loadRecordChunk(
    db,
    opts.modId,
    opts.srcLang,
    afterId,
    dbChunkSize,
    opts.force,
  );

  while (nextChunkPromise) {
    const dbChunk = await nextChunkPromise;
    if (dbChunk.length === 0) break;

    const lastId = dbChunk[dbChunk.length - 1]!.record_id;
    page++;
    afterId = lastId;

    nextChunkPromise =
      dbChunk.length >= dbChunkSize
        ? loadRecordChunk(db, opts.modId, opts.srcLang, lastId, dbChunkSize, opts.force)
        : Promise.resolve([]);

    if (processBatchSize != null && processBatchSize > 0) {
      for (let i = 0; i < dbChunk.length; i += processBatchSize) {
        yield { page, chunk: dbChunk.slice(i, i + processBatchSize) };
      }
    } else {
      yield { page, chunk: dbChunk };
    }
  }
}

export const persistNarratorGenderResults = async (
  db: Tx,
  rows: Array<{
    recordId: number;
    gender: NarratorGender;
    source: NarratorGenderSource;
  }>,
): Promise<void> => {
  if (rows.length === 0) return;

  for (const row of rows) {
    await db.query(
      `UPDATE records
          SET narrator_gender = $2,
              narrator_gender_source = $3,
              gender_detect_scanned_at = NOW()
        WHERE id = $1
          AND (narrator_gender_override IS NULL OR narrator_gender_override = '')`,
      [row.recordId, row.gender, row.source],
    );
  }
};

export const markGenderDetectScanned = async (db: Tx, recordIds: number[]): Promise<void> => {
  if (recordIds.length === 0) return;
  await db.query(
    `UPDATE records SET gender_detect_scanned_at = NOW() WHERE id = ANY($1::int[])`,
    [recordIds],
  );
};

export const resetModGenderDetectState = async (db: Tx, modId: number): Promise<number> => {
  const { rowCount } = await db.query(
    `UPDATE records
        SET gender_detect_scanned_at = NULL,
            narrator_gender = NULL,
            narrator_gender_source = NULL
      WHERE mod_id = $1
        AND signature IN ('BOOK', 'TERM', 'NOTE')
        AND (narrator_gender_override IS NULL OR narrator_gender_override = '')`,
    [modId],
  );
  return rowCount ?? 0;
};
