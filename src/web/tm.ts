import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';
import { upsertTranslation } from './queries.js';

// ── TM Auto-apply ─────────────────────────────────────────────────────────────

type MatchMethod = 'anchor' | 'edid' | 'text_norm';
type Match = { text: string; method: MatchMethod; confidence: number };

/**
 * Find the best existing translation for a source string using three
 * successive match strategies (highest confidence first):
 *   1. anchor  — same formid_hex + path in any other mod
 *   2. edid    — same EDID in any other mod
 *   3. text_norm — identical normalised source text anywhere in the DB
 */
const findBestMatch = async (
  db: Tx,
  formidHex: string | null,
  path: string,
  edid: string | null,
  textNorm: string,
  targetLang: string,
  excludeModId: number,
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
       WHERE r.formid_hex = $2 AND r.path = $3 AND s.lang = 'en' AND r.mod_id != $4
       ${orderByStatus}`,
      [targetLang, formidHex, path, excludeModId],
    );
    if (rows[0]) return { text: rows[0].text, method: 'anchor', confidence: 0.95 };
  }

  // 2. EDID match
  if (edid) {
    const { rows } = await db.query(
      `SELECT t.text FROM strings s
       JOIN records r ON s.record_id = r.id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE r.edid = $2 AND s.lang = 'en' AND r.mod_id != $3
       ${orderByStatus}`,
      [targetLang, edid, excludeModId],
    );
    if (rows[0]) return { text: rows[0].text, method: 'edid', confidence: 0.85 };
  }

  // 3. Exact text_norm match
  const { rows } = await db.query(
    `SELECT t.text FROM strings s
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
     WHERE s.text_norm = $2 AND s.lang = 'en'
     ${orderByStatus}`,
    [targetLang, textNorm],
  );
  if (rows[0]) return { text: rows[0].text, method: 'text_norm', confidence: 0.75 };

  return null;
}

/**
 * Apply TM to all untranslated strings in a mod.
 * Only fills strings that have NO existing translation for targetLang.
 * Returns counts of applied/skipped matches and a breakdown by method.
 */
export const applyTMToMod = async (
  db: Tx,
  modId: number,
  targetLang = 'uk',
): Promise<{ applied: number; skipped: number; byMethod: Record<string, number> }> => {
  const { rows: untranslated } = await db.query(
    `SELECT s.id, s.text_norm, r.formid_hex, r.path, r.edid
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = 'en'
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $2
       )`,
    [modId, targetLang],
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
      );
      if (match) {
        await upsertTranslation(client, s.id, match.text, 'tm', targetLang, 'tm_auto');
        applied++;
        byMethod[match.method] = (byMethod[match.method] ?? 0) + 1;
      }
    }
  });

  return { applied, skipped: untranslated.length - applied, byMethod };
}

// ── Translation propagation ───────────────────────────────────────────────────

/**
 * After saving a translation, propagate it to all other strings with the same
 * text_norm that don't yet have a reviewed or in-progress manual translation.
 * Returns the number of strings that received the propagated translation.
 */
export const propagateTranslation = async (
  db: Tx,
  textNorm: string,
  translatedText: string,
  targetLang: string,
  excludeStringId: number,
): Promise<number> => {
  const { rows: candidates } = await db.query(
    `SELECT s.id FROM strings s
     WHERE s.text_norm = $1 AND s.lang = 'en' AND s.id != $2
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $3 AND t.status IN ('draft', 'reviewed', 'human')
       )`,
    [textNorm, excludeStringId, targetLang],
  );

  if (candidates.length === 0) return 0;
  log.info(`TM propagation: ${candidates.length} candidates for text_norm propagation`);

  await withTransaction(db as pg.Pool, async (client) => {
    for (const c of candidates) {
      await upsertTranslation(client, c.id, translatedText, 'tm', targetLang, 'propagation');
    }
  });

  return candidates.length;
}
