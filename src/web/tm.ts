/**
 * tm.ts
 *
 * Translation Memory (TM) helpers used by the web application.
 *
 * This module provides two related features:
 * - **TM auto-apply**: populate missing translations for a mod by searching the
 *   existing database using increasingly relaxed match strategies.
 * - **Propagation**: when a user saves a translation for one string, optionally
 *   copy it to other strings with the same normalised source text that do not
 *   yet have a strong manual translation.
 *
 * The TM logic intentionally prefers high-quality translations first (reviewed
 * > human > tm > fuzzy > auto > draft) and records provenance for auditability.
 */
import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';
import { CONFIG } from '../config.js';
import { upsertTranslation } from './queries.js';
import { extractNumbers, transplantNumbers, segmentPhrases, normalizeForHash } from '../utils/textNorm.js';

// ── TM Auto-apply ─────────────────────────────────────────────────────────────

type MatchMethod = 'anchor' | 'edid' | 'text_norm' | 'numeric' | 'punct_norm' | 'fuzzy' | 'phrase' | 'reverse_tm';
type Match = { text: string; method: MatchMethod; confidence: number };

/**
 * Find the best existing translation for a source string using six
 * successive match strategies (highest confidence first):
 *   1. anchor     — same formid_hex + path in any other mod
 *   2. edid       — same EDID in any other mod
 *   3. text_norm  — identical normalised source text anywhere in the DB
 *   3b. numeric   — text_norm match with number transplant
 *   4. punct_norm — identical text after stripping punctuation
 *   5. fuzzy      — pg_trgm trigram similarity ≥ 0.3
 *   6. phrase     — split into sentence/clause segments, look up each;
 *                   only produces a match when ALL segments have a
 *                   text_norm translation ("DicoBy_Phrase" all-or-nothing)
 */
const findBestMatch = async (
  db: Tx,
  formidHex: string | null,
  path: string,
  edid: string | null,
  textNorm: string,
  textNormNopunct: string | null,
  textRaw: string,
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

  // 3. Exact text_norm match — prefer identical raw text, then try numeric transplant
  {
    const { rows } = await db.query(
      `SELECT t.text, s.text_raw FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE s.text_norm = $2 AND s.lang = $3
       ${orderByStatus}`,
      [targetLang, textNorm, srcLang],
    );
    if (rows[0]) {
      /* If raw texts are identical → true text_norm match. */
      if (rows[0].text_raw === textRaw) {
        return { text: rows[0].text, method: 'text_norm', confidence: 0.75 };
      }
      /* Raw texts differ → numbers changed. Try to transplant. */
      const oldNums = extractNumbers(rows[0].text_raw);
      const newNums = extractNumbers(textRaw);
      const transplanted = transplantNumbers(rows[0].text, oldNums, newNums);
      if (transplanted !== null) {
        return { text: transplanted, method: 'numeric', confidence: 0.70 };
      }
      /* Transplant failed (count mismatch etc.) — still a text_norm match. */
      return { text: rows[0].text, method: 'text_norm', confidence: 0.75 };
    }
  }

  // 4. Punctuation-normalized match
  if (textNormNopunct) {
    const { rows } = await db.query(
      `SELECT t.text FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE s.text_norm_nopunct = $2 AND s.lang = $4 AND s.text_norm <> $3
       ${orderByStatus}`,
      [targetLang, textNormNopunct, textNorm, srcLang],
    );
    if (rows[0]) return { text: rows[0].text, method: 'punct_norm', confidence: 0.65 };
  }

  // 5. Fuzzy trigram match (pg_trgm)
  if (textNorm.length >= 4) {
    const { rows } = await db.query(
      `SELECT t.text, similarity(s.text_norm, $2) AS sim FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE s.text_norm % $2 AND s.lang = $3 AND s.text_norm <> $2
       ORDER BY sim DESC, CASE t.status
         WHEN 'reviewed' THEN 1
         WHEN 'human' THEN 2
         WHEN 'tm' THEN 3
         WHEN 'fuzzy' THEN 4
         WHEN 'auto' THEN 5
         WHEN 'draft' THEN 6
         ELSE 7 END
       LIMIT 1`,
      [targetLang, textNorm, srcLang],
    );
    if (rows[0]) return { text: rows[0].text, method: 'fuzzy', confidence: Math.round(rows[0].sim * 100) / 100 };
  }

  // 6. Phrase segmentation — split text into clauses, look up each segment.
  //    "DicoBy_Phrase" all-or-nothing: every segment must have a text_norm
  //    translation, otherwise no match is produced. The concatenated result is
  //    returned with confidence 0.55 and saved as 'fuzzy' status.
  {
    const segments = segmentPhrases(textRaw);
    if (segments.length >= 2) {
      const parts: string[] = [];
      let allFound = true;

      for (const seg of segments) {
        const segNorm = normalizeForHash(seg);
        if (!segNorm || segNorm.length < 3) {
          /* Tiny fragment (pure punctuation / whitespace) — pass through as-is */
          parts.push(seg);
          continue;
        }

        const { rows: segRows } = await db.query(
          `SELECT t.text FROM strings s
           JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
           WHERE s.text_norm = $2 AND s.lang = $3
           ORDER BY CASE t.status
             WHEN 'reviewed' THEN 1
             WHEN 'human' THEN 2
             WHEN 'tm' THEN 3
             WHEN 'fuzzy' THEN 4
             WHEN 'auto' THEN 5
             WHEN 'draft' THEN 6
             ELSE 7 END
           LIMIT 1`,
          [targetLang, segNorm, srcLang],
        );

        if (segRows[0]) {
          parts.push(segRows[0].text);
        } else {
          allFound = false;
          break;
        }
      }

      if (allFound && parts.length >= 2) {
        return { text: parts.join(' '), method: 'phrase', confidence: 0.55 };
      }
    }
  }

  // 7. Reverse TM: look for confirmed translations in the opposite direction.
  //    If found a string in targetLang with a translation pointing to srcLang,
  //    use the targetLang string's raw text as our source text's translation.
  //    This enables bidirectional use of confirmed pairs (especially useful for
  //    localized imports where ru↔en pairs can be used in either direction).
  {
    const { rows } = await db.query(
      `SELECT s_reverse.text_raw FROM strings s_reverse
       JOIN translations t_reverse ON t_reverse.src_string_id = s_reverse.id
       WHERE s_reverse.lang = $1 AND s_reverse.text_norm = $2 AND t_reverse.target_lang = $3
       ${orderByStatus}`,
      [targetLang, textNorm, srcLang],
    );
    if (rows[0]) {
      const reverseTargetText = rows[0].text_raw;
      /* If raw texts already match, this is a direct text_norm hit (should have been caught earlier). */
      if (reverseTargetText !== textRaw) {
        return { text: reverseTargetText, method: 'reverse_tm', confidence: 0.72 };
      }
    }
  }

  return null;
}

/**
 * Apply TM to all untranslated strings in a mod.
 * Only fills strings that have NO existing translation for targetLang.
 * Returns counts of applied/skipped matches and a breakdown by method.
 */
/**
 * Auto-apply translation memory to all untranslated strings in a mod.
 *
 * Only strings that have **no** translation for `targetLang` are considered.
 * Each string is matched using {@link findBestMatch}. When a match is found,
 * a new translation is upserted with status:
 * - `tm` for strong deterministic methods (anchor/edid/text_norm),
 * - `fuzzy` for weaker heuristics (punct_norm/numeric/fuzzy/phrase).
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
    `SELECT s.id, s.text_raw, s.text_norm, s.text_norm_nopunct, r.formid_hex, r.path, r.edid
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $3
       AND NOT EXISTS (
         SELECT 1 FROM translations t
         WHERE t.src_string_id = s.id AND t.target_lang = $2
       )`,
    [modId, targetLang, srcLang],
  );
  log.info(`TM auto-apply: ${untranslated.length} untranslated strings for mod ${modId}`);

  let applied = 0;
  const byMethod: Record<string, number> = { anchor: 0, edid: 0, text_norm: 0, numeric: 0, punct_norm: 0, fuzzy: 0, phrase: 0, reverse_tm: 0 };

  await withTransaction(db as pg.Pool, async (client) => {
    for (const s of untranslated) {
      const match = await findBestMatch(
        client,
        s.formid_hex,
        s.path,
        s.edid,
        s.text_norm,
        s.text_norm_nopunct,
        s.text_raw,
        targetLang,
        modId,
        srcLang,
      );
      if (match) {
        const tmStatus = match.method === 'fuzzy' || match.method === 'punct_norm' || match.method === 'numeric' || match.method === 'phrase'
          ? 'fuzzy' : 'tm';
        await upsertTranslation(client, s.id, match.text, tmStatus, targetLang, `tm_auto_${match.method}`);
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
}
