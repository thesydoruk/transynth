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
import type { Tx } from '../db';
import { withTransaction } from '../db';
import type pg from 'pg';
import { log } from '../logger';
import { CONFIG } from '../config';
import { upsertTranslation } from './queries';

// ── TM Auto-apply ─────────────────────────────────────────────────────────────

type MatchMethod = 'anchor' | 'edid' | 'text_norm';
type Match = { text: string; method: MatchMethod; confidence: number };

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
  const { rows: untranslated } = await db.query(
    `SELECT s.id, s.text_norm, r.formid_hex, r.path, r.edid
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $3
       AND s.is_ignored = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $2
       )`,
    [modId, targetLang, srcLang],
  );
  log.info(`TM auto-apply: ${untranslated.length} untranslated strings for mod ${modId}`);

  let applied = 0;
  const byMethod: Record<string, number> = { anchor: 0, edid: 0, text_norm: 0 };

  await withTransaction(db as pg.Pool, async (client) => {
    for (const s of untranslated) {
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

  return { applied, skipped: untranslated.length - applied, byMethod };
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
