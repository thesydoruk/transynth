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
import { upsertTranslation } from '../data/queries';
import { mapWithConcurrency } from '../../utils/concurrency';

// ── TM Auto-apply ─────────────────────────────────────────────────────────────

type MatchMethod = 'anchor' | 'edid' | 'text_norm';
type Match = { text: string; method: MatchMethod; confidence: number };

type UntranslatedRow = {
  id: number;
  text_norm: string;
  formid_hex: string | null;
  path: string;
  edid: string | null;
};

const untranslatedWhereSql = `
  r.mod_id = $1 AND s.lang = $3
  AND s.is_ignored = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM translations t
    WHERE t.src_string_id = s.id AND t.target_lang = $2
  )`;

/**
 * Find the best existing translation for a source string using three
 * deterministic, exact-reuse strategies (highest confidence first):
 *   1. anchor     — same formid_hex + path in any other mod
 *   2. edid       — same EDID in any other mod
 *   3. text_norm  — identical normalised source text anywhere in the DB
 *
 * Only exact/anchor matches are produced. Approximate heuristics (fuzzy
 * trigram, punctuation-stripped, numeric transplant, phrase segmentation,
 * reverse TM) were removed: the LLM + RAG pipeline produces higher-quality
 * results for non-exact strings, so TM is now limited to free, instant,
 * lossless reuse of identical source text.
 */
const findBestMatch = async (
  db: Tx,
  formidHex: string | null,
  path: string,
  edid: string | null,
  textNorm: string,
  targetLang: string,
  excludeModId: number,
  srcLang: string,
): Promise<Match | null> => {
  const orderByStatus = `ORDER BY CASE t.status
    WHEN 'reviewed' THEN 1
    WHEN 'human' THEN 2
    WHEN 'tm' THEN 3
    WHEN 'fuzzy' THEN 4
    WHEN 'auto' THEN 5
    WHEN 'draft' THEN 6
    ELSE 7 END LIMIT 1`;

  // 1. Anchor: same formid + path
  if (formidHex) {
    const { rows } = await db.query(
      `SELECT t.text FROM strings s
       JOIN records r ON s.record_id = r.id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE r.formid_hex = $2 AND r.path = $3 AND s.lang = $5 AND r.mod_id != $4
       ${orderByStatus}`,
      [targetLang, formidHex, path, excludeModId, srcLang],
    );
    if (rows[0]) return { text: rows[0].text, method: 'anchor', confidence: 0.95 };
  }

  // 2. EDID match
  if (edid) {
    const { rows } = await db.query(
      `SELECT t.text FROM strings s
       JOIN records r ON s.record_id = r.id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE r.edid = $2 AND s.lang = $4 AND r.mod_id != $3
       ${orderByStatus}`,
      [targetLang, edid, excludeModId, srcLang],
    );
    if (rows[0]) return { text: rows[0].text, method: 'edid', confidence: 0.85 };
  }

  // 3. Exact text_norm match — identical normalised source text anywhere.
  {
    const { rows } = await db.query(
      `SELECT t.text FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE s.text_norm = $2 AND s.lang = $3
       ${orderByStatus}`,
      [targetLang, textNorm, srcLang],
    );
    if (rows[0]) return { text: rows[0].text, method: 'text_norm', confidence: 0.75 };
  }

  return null;
};

const countUntranslatedStrings = async (
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
): Promise<UntranslatedRow[]> => {
  const { rows } = await db.query<UntranslatedRow>(
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

const splitChunk = (chunk: UntranslatedRow[], workers: number): UntranslatedRow[][] => {
  if (chunk.length === 0) return [];
  const parts = Math.min(Math.max(1, workers), chunk.length);
  const sliceSize = Math.ceil(chunk.length / parts);
  const out: UntranslatedRow[][] = [];
  for (let i = 0; i < chunk.length; i += sliceSize) {
    out.push(chunk.slice(i, i + sliceSize));
  }
  return out;
};

const mergeByMethod = (target: Record<string, number>, partial: Record<string, number>): void => {
  for (const [method, count] of Object.entries(partial)) {
    target[method] = (target[method] ?? 0) + count;
  }
};

const applyTMSubChunk = async (
  db: pg.Pool,
  modId: number,
  targetLang: string,
  srcLang: string,
  chunk: UntranslatedRow[],
): Promise<{ applied: number; byMethod: Record<string, number> }> => {
  const byMethod: Record<string, number> = { anchor: 0, edid: 0, text_norm: 0 };
  let applied = 0;

  await withTransaction(db, async (client) => {
    for (const s of chunk) {
      const match = await findBestMatch(
        client,
        s.formid_hex,
        s.path,
        s.edid,
        s.text_norm,
        targetLang,
        modId,
        srcLang,
      );
      if (match) {
        await upsertTranslation(
          client,
          s.id,
          match.text,
          'tm',
          targetLang,
          `tm_auto_${match.method}`,
        );
        applied++;
        byMethod[match.method] = (byMethod[match.method] ?? 0) + 1;
      }
    }
  });

  return { applied, byMethod };
};

const applyTMChunk = async (
  db: Tx,
  modId: number,
  targetLang: string,
  srcLang: string,
  chunk: UntranslatedRow[],
  byMethod: Record<string, number>,
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
 * Apply TM to all untranslated strings in a mod.
 * Only fills strings that have NO existing translation for targetLang.
 * Returns counts of applied/skipped matches and a breakdown by method.
 */
/**
 * Auto-apply translation memory to all untranslated strings in a mod.
 *
 * Only strings that have **no** translation for `targetLang` are considered.
 * Each string is matched using {@link findBestMatch}. When an exact/anchor
 * match is found, a new translation is upserted with status `tm`.
 *
 * Processing is paginated by {@link CONFIG.tmApplyChunkSize} (env: TM_APPLY_CHUNK_SIZE)
 * so large mods do not hold one long transaction or load all rows at once.
 * Within each chunk, up to {@link CONFIG.tmApplyWorkers} sub-chunks run in parallel
 * (env: TM_APPLY_WORKERS), each in its own DB transaction.
 *
 * @param db - Database handle.
 * @param modId - Mod id to process.
 * @param targetLang - Target language code.
 * @param srcLang - Source language code.
 * @returns Counts of applied/skipped translations and a breakdown by method.
 */
export const applyTMToMod = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ applied: number; skipped: number; byMethod: Record<string, number> }> => {
  const chunkSize = CONFIG.tmApplyChunkSize;
  const workers = CONFIG.tmApplyWorkers;
  const totalUntranslated = await countUntranslatedStrings(db, modId, targetLang, srcLang);
  log.info(
    `TM auto-apply: ${totalUntranslated} untranslated strings for mod ${modId}, chunkSize=${chunkSize}, workers=${workers}`,
  );

  let applied = 0;
  let processed = 0;
  const byMethod: Record<string, number> = { anchor: 0, edid: 0, text_norm: 0 };
  let afterStringId = 0;

  while (true) {
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

    if (chunk.length < chunkSize) break;
  }

  return { applied, skipped: processed - applied, byMethod };
};

// ── Translation propagation ───────────────────────────────────────────────────

/**
 * After saving a translation, propagate it to all other strings with the same
 * text_norm that don't yet have a reviewed or in-progress manual translation.
 * Returns the number of strings that received the propagated translation.
 */
/**
 * Propagate a newly saved translation to other strings with the same `text_norm`.
 *
 * This is used to reduce repetitive work: if two records share identical
 * normalised source text, a manual translation can be re-used. The propagation
 * is conservative: it does not overwrite strong existing translations.
 *
 * @param db - Database handle.
 * @param textNorm - Normalised source text key (`strings.text_norm`).
 * @param translatedText - Translation text to propagate.
 * @param targetLang - Target language code.
 * @param excludeStringId - Source string id that triggered the propagation (skip it).
 * @param srcLang - Source language code.
 * @returns Number of strings that received the propagated translation.
 */
export const propagateTranslation = async (
  db: Tx,
  textNorm: string,
  translatedText: string,
  targetLang: string,
  excludeStringId: number,
  srcLang = CONFIG.defaultSrcLang,
): Promise<number> => {
  const { rows: candidates } = await db.query(
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

  await withTransaction(db as pg.Pool, async (client) => {
    for (const c of candidates) {
      await upsertTranslation(client, c.id, translatedText, 'tm', targetLang, 'propagation');
    }
  });

  return candidates.length;
};
