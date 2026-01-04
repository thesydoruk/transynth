import type { Tx } from '../db.js';

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
function findBestMatch(
  db: Tx,
  formidHex: string | null,
  path: string,
  edid: string | null,
  textNorm: string,
  targetLang: string,
  excludeModId: number,
): Match | null {
  const orderByStatus = `ORDER BY CASE t.status WHEN 'human' THEN 1 WHEN 'tm' THEN 2 WHEN 'fuzzy' THEN 3 ELSE 4 END LIMIT 1`;

  // 1. Anchor: same formid + path
  if (formidHex) {
    const row = db
      .prepare(
        `SELECT t.text FROM strings s
         JOIN records r ON s.record_id = r.id
         JOIN translations t ON t.src_string_id = s.id AND t.target_lang = ?
         WHERE r.formid_hex = ? AND r.path = ? AND s.lang = 'en' AND r.mod_id != ?
         ${orderByStatus}`,
      )
      .get(targetLang, formidHex, path, excludeModId) as { text: string } | undefined;
    if (row) return { text: row.text, method: 'anchor', confidence: 0.95 };
  }

  // 2. EDID match
  if (edid) {
    const row = db
      .prepare(
        `SELECT t.text FROM strings s
         JOIN records r ON s.record_id = r.id
         JOIN translations t ON t.src_string_id = s.id AND t.target_lang = ?
         WHERE r.edid = ? AND s.lang = 'en' AND r.mod_id != ?
         ${orderByStatus}`,
      )
      .get(targetLang, edid, excludeModId) as { text: string } | undefined;
    if (row) return { text: row.text, method: 'edid', confidence: 0.85 };
  }

  // 3. Exact text_norm match
  const row = db
    .prepare(
      `SELECT t.text FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = ?
       WHERE s.text_norm = ? AND s.lang = 'en'
       ${orderByStatus}`,
    )
    .get(targetLang, textNorm) as { text: string } | undefined;
  if (row) return { text: row.text, method: 'text_norm', confidence: 0.75 };

  return null;
}

/**
 * Apply TM to all untranslated strings in a mod.
 * Only fills strings that have NO existing translation for targetLang.
 * Returns counts of applied/skipped matches and a breakdown by method.
 */
export function applyTMToMod(
  db: Tx,
  modId: number,
  targetLang = 'uk',
): { applied: number; skipped: number; byMethod: Record<string, number> } {
  const untranslated = db
    .prepare(
      `SELECT s.id, s.text_norm, r.formid_hex, r.path, r.edid
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = ? AND s.lang = 'en'
         AND NOT EXISTS (
           SELECT 1 FROM translations t
           WHERE t.src_string_id = s.id AND t.target_lang = ?
         )`,
    )
    .all(modId, targetLang) as Array<{
    id: number;
    text_norm: string;
    formid_hex: string | null;
    path: string;
    edid: string | null;
  }>;

  let applied = 0;
  const byMethod: Record<string, number> = { anchor: 0, edid: 0, text_norm: 0 };

  const insert = db.prepare(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, updated_at)
     VALUES (?, ?, ?, 'tm', ?, 'tm_auto', CURRENT_TIMESTAMP)`,
  );

  db.transaction(() => {
    for (const s of untranslated) {
      const match = findBestMatch(
        db,
        s.formid_hex,
        s.path,
        s.edid,
        s.text_norm,
        targetLang,
        modId,
      );
      if (match) {
        insert.run(s.id, targetLang, match.text, match.confidence);
        applied++;
        byMethod[match.method] = (byMethod[match.method] ?? 0) + 1;
      }
    }
  })();

  return { applied, skipped: untranslated.length - applied, byMethod };
}

// ── Translation propagation ───────────────────────────────────────────────────

/**
 * After saving a translation, propagate it to all other strings with the same
 * text_norm that don't yet have a human-approved translation.
 * Returns the number of strings that received the propagated translation.
 */
export function propagateTranslation(
  db: Tx,
  textNorm: string,
  translatedText: string,
  targetLang: string,
  excludeStringId: number,
): number {
  const candidates = db
    .prepare(
      `SELECT s.id FROM strings s
       WHERE s.text_norm = ? AND s.lang = 'en' AND s.id != ?
         AND NOT EXISTS (
           SELECT 1 FROM translations t
           WHERE t.src_string_id = s.id AND t.target_lang = ? AND t.status = 'human'
         )`,
    )
    .all(textNorm, excludeStringId, targetLang) as Array<{ id: number }>;

  if (candidates.length === 0) return 0;

  const del = db.prepare(
    `DELETE FROM translations WHERE src_string_id = ? AND target_lang = ? AND status != 'human'`,
  );
  const ins = db.prepare(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, updated_at)
     VALUES (?, ?, ?, 'tm', 0.95, 'propagation', CURRENT_TIMESTAMP)`,
  );

  db.transaction(() => {
    for (const c of candidates) {
      del.run(c.id, targetLang);
      ins.run(c.id, targetLang, translatedText);
    }
  })();

  return candidates.length;
}
