import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { DIALOG_PARTICIPANT_COLUMNS, dialogParticipantsLateralSql } from './dialogs';
import {
  collectQAIssuesForRow,
  bulkInsertQAIssues,
  loadQaCheckSettings,
  loadGlossaryTermsForQa,
  loadQaRulesForGame,
  qaRuleGameKey,
  type QaRuleRow,
  type QaTranslationContextRow,
} from './qaHelpers';

export const refreshQAIssues = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<void> => {
  await refreshQAIssuesBatch(db, [stringId], targetLang, srcLang);
};

/**
 * Recompute QA issues for many strings in one pass — shared settings/glossary loads,
 * batched delete/insert. Used by the LLM auto-translate pipeline (async).
 */
export const refreshQAIssuesBatch = async (
  db: Tx,
  stringIds: number[],
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
  opts?: { skipDuplicateCheck?: boolean },
): Promise<void> => {
  if (stringIds.length === 0) return;

  const qaSettings = await loadQaCheckSettings(db);
  const glossaryTerms = await loadGlossaryTermsForQa(db, srcLang, targetLang);

  const { rows } = await db.query<QaTranslationContextRow & { string_id: number }>(
    `SELECT s.id AS string_id,
            s.text_raw AS source, s.is_ignored,
            t.id AS translation_id, t.text AS translation, t.status AS translation_status,
            r.signature, r.path, m.game,
            ${DIALOG_PARTICIPANT_COLUMNS}
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     LEFT JOIN LATERAL (${dialogParticipantsLateralSql('r')}
     ) dp ON TRUE
     WHERE s.id = ANY($1::int[])`,
    [stringIds, targetLang],
  );

  await db.query(
    `DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
    [stringIds, targetLang],
  );

  const duplicateAltsByStringId = new Map<number, string[]>();
  if (!opts?.skipDuplicateCheck) {
    const { rows: duplicateRows } = await db.query<{ string_id: number; alt_text: string }>(
      `SELECT s1.id AS string_id, t2.text AS alt_text
       FROM strings s1
       JOIN records r1 ON r1.id = s1.record_id
       JOIN translations t1 ON t1.src_string_id = s1.id AND t1.target_lang = $2
       JOIN strings s2
         ON s2.text_raw = s1.text_raw AND s2.lang = s1.lang AND s2.id <> s1.id
        AND s1.text_raw <> ''
       JOIN records r2
         ON r2.id = s2.record_id
        AND COALESCE(r2.signature, '') = COALESCE(r1.signature, '')
       JOIN translations t2 ON t2.src_string_id = s2.id AND t2.target_lang = $2
       WHERE s1.id = ANY($1::int[])
         AND t2.text <> t1.text`,
      [stringIds, targetLang],
    );
    for (const dup of duplicateRows) {
      const existing = duplicateAltsByStringId.get(dup.string_id) ?? [];
      if (!existing.includes(dup.alt_text)) existing.push(dup.alt_text);
      duplicateAltsByStringId.set(dup.string_id, existing);
    }
  }

  const qaRulesByGame = new Map<string, QaRuleRow[]>();
  const issueRows: Array<{
    stringId: number;
    translationId: number | null;
    targetLang: string;
    issueType: string;
    severity: string;
    message: string;
  }> = [];

  for (const row of rows) {
    const gameKey = qaRuleGameKey(row.game);
    let qaRules = qaRulesByGame.get(gameKey);
    if (!qaRules) {
      qaRules = await loadQaRulesForGame(db, gameKey);
      qaRulesByGame.set(gameKey, qaRules);
    }

    const issues = collectQAIssuesForRow(
      row,
      { targetLang, settings: qaSettings, rules: qaRules, glossaryTerms },
      (duplicateAltsByStringId.get(row.string_id) ?? []).slice(0, 5),
    );
    for (const issue of issues) {
      issueRows.push({
        stringId: row.string_id,
        translationId: row.translation_id ?? null,
        targetLang,
        issueType: issue.issueType,
        severity: issue.severity,
        message: issue.message,
      });
    }
  }

  await bulkInsertQAIssues(db, issueRows);
};

export const getQAIssues = async (db: Tx, stringId: number, targetLang = CONFIG.defaultTgtLang) => {
  const { rows } = await db.query(
    `SELECT id, issue_type, severity, message, updated_at
     FROM qa_issues
     WHERE src_string_id = $1 AND target_lang = $2 AND is_active = TRUE
     ORDER BY CASE severity WHEN 'error' THEN 1 ELSE 2 END, updated_at DESC, id DESC`,
    [stringId, targetLang],
  );
  return rows;
};
