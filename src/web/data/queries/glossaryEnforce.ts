import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { glossaryGameKey } from '../../../games/glossaryKey';
import { PENDING_REVIEW_STATUS_SQL } from './constants';
import { glossaryModGameSql, glossaryTermMatchesSource } from './glossaryHelpers';
import { loadGlossaryTermsForGame } from './glossaryLoad';

// ── Batch glossary enforcement ───────────────────────────────────────────────

/**
 * Batch-enforce glossary terms across translated strings for one game.
 *
 * 1. Deletes existing `glossary_violation` QA issues in the target scope.
 * 2. Fetches translated strings (optionally one mod; otherwise that game).
 * 3. For each string, checks whether every glossary term that appears in the
 *    English source has its required translation in the target text.
 * 4. Creates new `glossary_violation` QA issues for mismatches.
 */
export const enforceGlossary = async (
  db: Tx,
  opts: { modId?: number; targetLang?: string; srcLang?: string; game?: string | null } = {},
): Promise<{ checked: number; violations: number }> => {
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;
  const srcLang = opts.srcLang ?? CONFIG.defaultSrcLang;

  let game = opts.game;
  if (opts.modId) {
    const { rows: modRows } = await db.query<{ game: string }>(
      `SELECT game FROM mods WHERE id = $1`,
      [opts.modId],
    );
    game = modRows[0]?.game ?? game;
  }
  const gameKey = glossaryGameKey(game);

  const glossaryTerms = await loadGlossaryTermsForGame(db, srcLang, targetLang, gameKey, {
    requireTranslation: true,
  });
  if (glossaryTerms.length === 0) return { checked: 0, violations: 0 };

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
      `DELETE FROM qa_issues
       WHERE issue_type = 'glossary_violation' AND target_lang = $1
         AND src_string_id IN (
           SELECT s.id FROM strings s
           JOIN records r ON r.id = s.record_id
           JOIN mods m ON m.id = r.mod_id
           WHERE ${glossaryModGameSql()} = $2
         )`,
      [targetLang, gameKey],
    );
  }

  let stringsSQL = `
    SELECT s.id AS string_id, s.text_raw AS source,
           t.id AS translation_id, t.text AS translation
    FROM strings s
    JOIN records r ON r.id = s.record_id
    JOIN mods m ON m.id = r.mod_id
    JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
    WHERE t.text IS NOT NULL AND t.text <> ''
      AND s.is_ignored = FALSE
      AND t.status IN ${PENDING_REVIEW_STATUS_SQL}
      AND ${glossaryModGameSql()} = $2`;

  const params: unknown[] = [targetLang, gameKey];
  if (opts.modId) {
    stringsSQL += ` AND r.mod_id = $3`;
    params.push(opts.modId);
  }

  const { rows: strings } = await db.query(stringsSQL, params);

  const checks = glossaryTerms.map((g) => ({
    tgtNeedle: (g.translation ?? '').toLowerCase(),
    term: g.term,
    translation: g.translation ?? '',
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

  for (const v of insertValues) {
    await db.query(
      `INSERT INTO qa_issues(src_string_id, translation_id, target_lang, issue_type, severity, message, is_active, updated_at)
       VALUES ($1, $2, $3, 'glossary_violation', 'warning', $4, TRUE, NOW())`,
      v,
    );
  }

  return { checked: strings.length, violations };
};
