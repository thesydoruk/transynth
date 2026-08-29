import type { Tx } from '../../../../src/db';
import { DB_CHUNK_SIZE } from '../../../../src/config';
import type { ScanStringRow, SkipDetectWorkUnit } from './types';

/** Rows fetched from the database per pagination step (see CONFIG.dbChunkSize). */
export const SKIP_DETECT_DB_CHUNK_SIZE = DB_CHUNK_SIZE;

export type { LlmSkipDetectCandidate, ScanStringRow, SkipDetectWorkUnit } from './types';

const scannableFilterSql = (force: boolean): string =>
  force ? '' : 'AND s.is_ignored = FALSE AND s.skip_detect_scanned_at IS NULL';

export const countScannableStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  force: boolean,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        ${scannableFilterSql(force)}`,
    [modId, srcLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

const loadScanChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  afterId: number,
  limit: number,
  force: boolean,
): Promise<ScanStringRow[]> => {
  const { rows } = await db.query<ScanStringRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            r.signature,
            r.path,
            r.edid,
            s.context
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.id > $3
        ${scannableFilterSql(force)}
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, afterId, limit],
  );
  return rows;
};

/** Stream scan chunks from the DB — prefetches the next page while workers drain the current one. */
export async function* iterateSkipDetectWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    force: boolean;
    dbChunkSize?: number;
    /** Split each DB page into smaller worker batches (e.g. LLM batch size). */
    processBatchSize?: number;
  },
): AsyncGenerator<SkipDetectWorkUnit> {
  let afterId = 0;
  let page = 0;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? DB_CHUNK_SIZE);
  const processBatchSize = opts.processBatchSize;

  let nextChunkPromise: Promise<ScanStringRow[]> = loadScanChunk(
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

    const lastId = dbChunk[dbChunk.length - 1]!.string_id;
    page++;
    afterId = lastId;

    nextChunkPromise =
      dbChunk.length >= dbChunkSize
        ? loadScanChunk(db, opts.modId, opts.srcLang, lastId, dbChunkSize, opts.force)
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
