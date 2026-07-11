/**
 * tm.ts
 *
 * Translation Memory (TM) helpers used by the web application.
 *
 * This module provides two related features:
 * - **TM auto-apply**: populate missing translations for a mod by searching the
 *   existing database for exact/anchor matches (formid+path, EDID, or identical
 *   normalised source text). Approximate heuristics were removed in favour of
 *   the LLM + RAG pipeline; TM now only does lossless reuse of identical text.
 * - **Propagation**: when a user saves a translation for one string, optionally
 *   copy it to other strings with the same normalised source text that do not
 *   yet have a strong manual translation.
 *
 * The TM logic intentionally prefers high-quality translations first (reviewed
 * > human > tm > auto > draft) and records provenance for auditability.
 */
import type { Tx } from '../../db';
import { withTransaction } from '../../db';
import type pg from 'pg';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import { mapWithConcurrency } from '../../utils/concurrency';
import {
  bulkApplyTmBatch,
  bulkUpsertTmTranslations,
  type TmMatchMethod,
  type TmUntranslatedRow,
} from './tmBulk';

// ── TM Auto-apply ─────────────────────────────────────────────────────────────

const untranslatedWhereSql = `
  r.mod_id = $1 AND s.lang = $3
  AND s.is_ignored = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM translations t
    WHERE t.src_string_id = s.id AND t.target_lang = $2
  )`;

export const countUntranslatedStrings = async (
  db: Tx,
  modId: number,
  targetLang: string,
  srcLang: string,
): Promise<number> => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE ${untranslatedWhereSql}`,
    [modId, targetLang, srcLang],
  );
  return rows[0]?.n ?? 0;
};

const fetchUntranslatedChunk = async (
  db: Tx,
  modId: number,
  targetLang: string,
  srcLang: string,
  chunkSize: number,
  afterStringId: number,
): Promise<TmUntranslatedRow[]> => {
  const { rows } = await db.query<TmUntranslatedRow>(
    `SELECT s.id, s.text_norm, r.formid_hex, r.path, r.edid
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE ${untranslatedWhereSql}
       AND s.id > $4
     ORDER BY s.id
     LIMIT $5`,
    [modId, targetLang, srcLang, afterStringId, chunkSize],
  );
  return rows;
};

const splitChunk = (chunk: TmUntranslatedRow[], workers: number): TmUntranslatedRow[][] => {
  if (chunk.length === 0) return [];
  const parts = Math.min(Math.max(1, workers), chunk.length);
  const sliceSize = Math.ceil(chunk.length / parts);
  const out: TmUntranslatedRow[][] = [];
  for (let i = 0; i < chunk.length; i += sliceSize) {
    out.push(chunk.slice(i, i + sliceSize));
  }
  return out;
};

const mergeByMethod = (
  target: Record<TmMatchMethod, number>,
  partial: Record<TmMatchMethod, number>,
): void => {
  for (const method of ['anchor', 'edid', 'text_norm'] as const) {
    target[method] += partial[method] ?? 0;
  }
};

const applyTMSubChunk = async (
  db: pg.Pool,
  modId: number,
  targetLang: string,
  srcLang: string,
  chunk: TmUntranslatedRow[],
): Promise<{ applied: number; byMethod: Record<TmMatchMethod, number> }> =>
  withTransaction(db, async (client) =>
    bulkApplyTmBatch(client, modId, chunk, targetLang, srcLang),
  );

const applyTMChunk = async (
  db: Tx,
  modId: number,
  targetLang: string,
  srcLang: string,
  chunk: TmUntranslatedRow[],
  byMethod: Record<TmMatchMethod, number>,
  workers: number,
): Promise<number> => {
  const pool = db as pg.Pool;
  const subChunks = splitChunk(chunk, workers);
  const partials = await mapWithConcurrency(subChunks, workers, (subChunk) =>
    applyTMSubChunk(pool, modId, targetLang, srcLang, subChunk),
  );

  let applied = 0;
  for (const partial of partials) {
    applied += partial.applied;
    mergeByMethod(byMethod, partial.byMethod);
  }

  return applied;
};

/**
 * Auto-apply translation memory to all untranslated strings in a mod.
 *
 * Only strings that have **no** translation for `targetLang` are considered.
 * Matches use set-based SQL (anchor → edid → text_norm) via {@link bulkApplyTmBatch}.
 *
 * Processing is paginated by {@link CONFIG.dbChunkSize} (env: DB_CHUNK_SIZE).
 * Within each chunk, up to {@link CONFIG.tmApplyWorkers} sub-chunks run in parallel
 * (env: TM_APPLY_WORKERS), each in its own DB transaction.
 */
export type TmApplyHandlers = {
  onProgress?: (progress: { done: number; total: number; applied: number }) => void;
  shouldCancel?: () => boolean;
};

export const applyTMToMod = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
  handlers?: TmApplyHandlers,
): Promise<{ applied: number; skipped: number; byMethod: Record<string, number> }> => {
  const chunkSize = CONFIG.dbChunkSize;
  const workers = CONFIG.tmApplyWorkers;
  const totalUntranslated = await countUntranslatedStrings(db, modId, targetLang, srcLang);
  log.info(
    `TM auto-apply: ${totalUntranslated} untranslated strings for mod ${modId}, chunkSize=${chunkSize}, workers=${workers}`,
  );

  let applied = 0;
  let processed = 0;
  const byMethod: Record<TmMatchMethod, number> = { anchor: 0, edid: 0, text_norm: 0 };
  let afterStringId = 0;

  while (true) {
    if (handlers?.shouldCancel?.()) break;

    const chunk = await fetchUntranslatedChunk(
      db,
      modId,
      targetLang,
      srcLang,
      chunkSize,
      afterStringId,
    );
    if (chunk.length === 0) break;

    const chunkApplied = await applyTMChunk(
      db,
      modId,
      targetLang,
      srcLang,
      chunk,
      byMethod,
      workers,
    );
    applied += chunkApplied;
    processed += chunk.length;
    afterStringId = chunk[chunk.length - 1]!.id;

    log.info(
      `TM auto-apply: mod ${modId} chunk done ${processed}/${totalUntranslated}, applied=${chunkApplied}, totalApplied=${applied}`,
    );

    handlers?.onProgress?.({ done: processed, total: totalUntranslated, applied });

    if (chunk.length < chunkSize) break;
  }

  return { applied, skipped: processed - applied, byMethod };
};

/**
 * Apply translation memory to specific untranslated string IDs.
 *
 * Strings that already have a translation, are ignored, or belong to another mod
 * are skipped. Only lossless TM matches are written (same rules as mod-wide apply).
 */
export const applyTMToStringIds = async (
  db: Tx,
  modId: number,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ applied: number; skipped: number; byMethod: Record<TmMatchMethod, number> }> => {
  if (stringIds.length === 0) {
    return { applied: 0, skipped: 0, byMethod: { anchor: 0, edid: 0, text_norm: 0 } };
  }

  const { rows } = await db.query<TmUntranslatedRow>(
    `SELECT s.id, s.text_norm, r.formid_hex, r.path, r.edid
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE s.id = ANY($1::int[])
       AND r.mod_id = $2
       AND s.lang = $4
       AND s.is_ignored = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $3
       )`,
    [stringIds, modId, targetLang, srcLang],
  );

  const byMethod: Record<TmMatchMethod, number> = { anchor: 0, edid: 0, text_norm: 0 };
  const workers = CONFIG.tmApplyWorkers;
  let applied = 0;

  for (let i = 0; i < rows.length; i += CONFIG.dbChunkSize) {
    const chunk = rows.slice(i, i + CONFIG.dbChunkSize);
    applied += await applyTMChunk(db, modId, targetLang, srcLang, chunk, byMethod, workers);
  }

  return { applied, skipped: stringIds.length - applied, byMethod };
};

// ── Translation propagation ───────────────────────────────────────────────────

/**
 * Propagate a newly saved translation to other strings with the same `text_norm`.
 *
 * Uses bulk upsert when multiple candidates match (no per-row QA/RAG during propagation).
 */
export const propagateTranslation = async (
  db: Tx,
  textNorm: string,
  translatedText: string,
  targetLang: string,
  excludeStringId: number,
  srcLang = CONFIG.defaultSrcLang,
): Promise<number> => {
  const { rows: candidates } = await db.query<{ id: number }>(
    `SELECT s.id FROM strings s
     WHERE s.text_norm = $1 AND s.lang = $4 AND s.id != $2
       AND s.is_ignored = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $3 AND t.status IN ('draft', 'reviewed', 'human')
       )`,
    [textNorm, excludeStringId, targetLang, srcLang],
  );

  if (candidates.length === 0) return 0;
  log.info(`TM propagation: ${candidates.length} candidates for text_norm propagation`);

  const writeRows = candidates.map((c) => ({
    stringId: c.id,
    text: translatedText,
    provenance: 'propagation',
    confidence: 1.0,
  }));

  await withTransaction(db as pg.Pool, async (client) => {
    await bulkUpsertTmTranslations(client, writeRows, targetLang);
  });

  return candidates.length;
};
