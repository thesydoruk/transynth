import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  BEST_TRANSLATION_ORDER,
  PENDING_REVIEW_STATUS_SQL,
} from './constants';
import { glossaryTermMatchesSource } from './glossaryHelpers';

// ── Batch glossary enforcement ───────────────────────────────────────────────

/**
 * Batch-enforce glossary terms across all translated strings in scope.
 *
 * 1. Deletes every existing `glossary_violation` QA issue in the target scope.
 * 2. Fetches **all** translated strings (optionally restricted to one mod).
 * 3. For each string, checks whether every glossary term that appears in the
 *    English source (matched with `\b` word boundaries) has its required
 *    translation present in the target text (case-insensitive substring).
 * 4. Creates new `glossary_violation` QA issues for any mismatches found.
 *
 * @param db          - Database transaction handle.
 * @param opts.modId  - Optional: restrict enforcement to strings belonging to this mod.
 * @param opts.targetLang - Target language to check (default `'uk'`).
 * @returns `{ checked, violations }` — how many strings were examined and how
 *          many individual glossary-violation issues were created.
 */
export const enforceGlossary = async (
  db: Tx,
  opts: { modId?: number; targetLang?: string; srcLang?: string } = {},
): Promise<{ checked: number; violations: number }> => {
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  /* ── 1. Load glossary terms (srcLang → targetLang) ───────────────────────── */
  const { rows: glossaryTerms } = await db.query(
    `SELECT term, translation FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND translation IS NOT NULL`,
    [opts.srcLang ?? CONFIG.defaultSrcLang, targetLang],
  );
  if (glossaryTerms.length === 0) return { checked: 0, violations: 0 };

  /* ── 2. Delete existing glossary_violation issues in scope ──────────── */
  if (opts.modId) {
    await db.query(
      `DELETE FROM qa_issues
       WHERE issue_type = 'glossary_violation' AND target_lang = $1
         AND src_string_id IN (
           SELECT s.id FROM strings s
           JOIN records r ON r.id = s.record_id
           WHERE r.mod_id = $2
         )`,
      [targetLang, opts.modId],
    );
  } else {
    await db.query(
      `DELETE FROM qa_issues WHERE issue_type = 'glossary_violation' AND target_lang = $1`,
      [targetLang],
    );
  }

  /* ── 3. Fetch all strings with their best translation ──────────────── */
  let stringsSQL = `
    SELECT s.id AS string_id, s.text_raw AS source,
           t.id AS translation_id, t.text AS translation
    FROM strings s
    JOIN records r ON r.id = s.record_id
    JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $1
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, updated_at DESC
        LIMIT 1
      )
    WHERE t.text IS NOT NULL AND t.text <> ''
      AND s.is_ignored = FALSE
      AND t.status IN ${PENDING_REVIEW_STATUS_SQL}`;

  const params: unknown[] = [targetLang];
  if (opts.modId) {
    stringsSQL += ` AND r.mod_id = $2`;
    params.push(opts.modId);
  }

  const { rows: strings } = await db.query(stringsSQL, params);

  /* ── 4. Build word-boundary checks and scan every string ───────────── */
  const checks = (glossaryTerms as Array<{ term: string; translation: string }>).map((g) => ({
    tgtNeedle: g.translation.toLowerCase(),
    term: g.term,
    translation: g.translation,
  }));

  let violations = 0;
  const insertValues: unknown[][] = [];

  for (const row of strings as Array<{
    string_id: number;
    source: string;
    translation_id: number;
    translation: string;
  }>) {
    const tgtLower = row.translation.toLowerCase();
    for (const c of checks) {
      if (glossaryTermMatchesSource(row.source, c.term) && !tgtLower.includes(c.tgtNeedle)) {
        insertValues.push([
          row.string_id,
          row.translation_id,
          targetLang,
          `Glossary: "${c.term}" should be translated as "${c.translation}".`,
        ]);
        violations++;
      }
    }
  }

  /* ── 5. Batch-insert all violations ────────────────────────────────── */
  for (const v of insertValues) {
    await db.query(
      `INSERT INTO qa_issues(src_string_id, translation_id, target_lang, issue_type, severity, message, is_active, updated_at)
       VALUES ($1, $2, $3, 'glossary_violation', 'warning', $4, TRUE, NOW())`,
      v,
    );
  }

  return { checked: strings.length, violations };
};
