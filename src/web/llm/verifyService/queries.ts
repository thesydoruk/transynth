import type { Tx } from '../../../db';
import { CONFIG, DB_CHUNK_SIZE } from '../../../config';
import { llmVerifyEligibleStatusSql } from '../../data/queries';
import { buildLlmTranslateChunks } from '../llmTranslateChunking';
import type { VerifyLlmWorkUnit, VerifyStringRow } from './types';

/** Rows fetched from the database per pagination step (see CONFIG.dbChunkSize). */
export const LLM_VERIFY_DB_CHUNK_SIZE = DB_CHUNK_SIZE;

export type { LlmVerifyIssue, VerifyLlmWorkUnit, VerifyStringRow } from './types';

export const countVerifiableStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  force = false,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND t.status IN ${llmVerifyEligibleStatusSql(force)}
        AND length(trim(t.text)) > 0`,
    [modId, srcLang, targetLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

/**
 * Keyset pagination by `s.id` (not OFFSET): when auto-approve promotes rows to
 * 'reviewed' they drop out of this filtered set mid-run, so OFFSET would shift
 * and silently skip rows. Fetching strictly `s.id > afterId` is stable under
 * concurrent status changes and avoids OFFSET scan cost on large mods.
 */
export const loadVerifyChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  afterId: number,
  limit: number,
  force = false,
): Promise<VerifyStringRow[]> => {
  const { rows } = await db.query<VerifyStringRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            t.text AS translation,
            s.text_norm,
            s.text_norm_nopunct,
            r.signature,
            r.path,
            r.edid,
            s.context
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND t.status IN ${llmVerifyEligibleStatusSql(force)}
        AND length(trim(t.text)) > 0
        AND s.id > $5
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, targetLang, limit, afterId],
  );
  return rows;
};

/** Stream LLM work units from the DB — prefetches the next page while workers drain the current one. */
export async function* iterateVerifyLlmChunks(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    dbChunkSize?: number;
    force?: boolean;
  },
): AsyncGenerator<VerifyLlmWorkUnit> {
  let afterStringId = 0;
  let page = 0;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_VERIFY_DB_CHUNK_SIZE);
  const force = opts.force === true;

  let nextPagePromise: Promise<VerifyStringRow[]> = loadVerifyChunk(
    db,
    opts.modId,
    opts.srcLang,
    opts.targetLang,
    afterStringId,
    dbChunkSize,
    force,
  );

  while (nextPagePromise) {
    const dbChunk = await nextPagePromise;
    if (dbChunk.length === 0) break;

    const lastId = dbChunk[dbChunk.length - 1]!.string_id;
    page++;
    afterStringId = lastId;

    nextPagePromise =
      dbChunk.length >= dbChunkSize
        ? loadVerifyChunk(db, opts.modId, opts.srcLang, opts.targetLang, lastId, dbChunkSize, force)
        : Promise.resolve([]);

    const llmChunks = buildLlmTranslateChunks(
      dbChunk.map((row) => ({ row, sourceText: row.source })),
      {
        batchSize: CONFIG.batchSize,
        maxSourceChars: CONFIG.llmBatchMaxSourceChars,
        singleRowMaxSourceChars: CONFIG.llmBatchMaxSingleSourceChars,
      },
    );

    for (const part of llmChunks) {
      yield { page, chunk: part.map((entry) => entry.row) };
    }
  }
}
