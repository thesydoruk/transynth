import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { normalizeAutoTranslationQuotes } from '../../../utils/textNorm';
import { recordTranslationRevision } from '../translationRevisions';
import { scheduleRagSync } from '../../services/ragHooks';
import type { TranslationStatus } from '../statusMachine';
import { refreshQAIssues } from './qaIssues';
import { markStringsAsSkip } from './translationsSkip';
import {
  llmTranslateEligibilitySql,
  type LlmTranslateOverwriteMode,
} from './constants';

export type { LlmTranslateOverwriteMode } from './constants';

export const upsertTranslation = async (
  db: Tx,
  stringId: number,
  rawText: string,
  status: Exclude<TranslationStatus, 'deleted'>,
  targetLang = CONFIG.defaultTgtLang,
  provenance?: string,
  model?: string,
  /** ID of the user who saved this translation. Null for automated pipelines. */
  userId: number | null = null,
) => {
  if (status === 'skip') {
    await markStringsAsSkip(db, [stringId]);
    return { id: stringId, text: '', status: 'skip' as const };
  }

  const text = normalizeAutoTranslationQuotes(rawText);

  const effectiveProvenance =
    provenance ??
    (status === 'draft' || status === 'reviewed' || status === 'rejected' || status === 'human'
      ? 'human_edit'
      : `${status}_generated`);

  await db.query(`DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2`, [
    stringId,
    targetLang,
  ]);

  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, user_id, updated_at)
     VALUES ($1, $2, $3, $4, 1.0, $5, $6, NOW())
     RETURNING id`,
    [stringId, targetLang, text, status, effectiveProvenance, userId],
  );

  const translationId = rows[0].id as number;
  await recordTranslationRevision(db, {
    stringId,
    translationId,
    targetLang,
    text,
    status,
    provenance: effectiveProvenance,
    model: model ?? null,
    note: 'save',
  });
  await refreshQAIssues(db, stringId, targetLang);

  scheduleRagSync(db, translationId);

  return { id: translationId, text, status };
};

/**
 * Keep only string IDs that LLM batch translate may process: not marked skip
 * (`is_ignored`) and eligible under {@link llmTranslateEligibilitySql}.
 */
export const filterStringIdsForLlmTranslate = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
  overwriteMode: LlmTranslateOverwriteMode = 'default',
): Promise<number[]> => {
  if (stringIds.length === 0) return [];
  const { rows } = await db.query<{ id: number }>(
    `SELECT s.id
       FROM strings s
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $2
      WHERE s.id = ANY($1::int[])
        AND s.is_ignored = FALSE
        AND ${llmTranslateEligibilitySql(overwriteMode)}`,
    [stringIds, targetLang],
  );
  return rows.map((r) => r.id);
};
