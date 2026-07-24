export type { TranslationStatus } from '../statusMachine';
import type { TranslationStatus } from '../statusMachine';

/** Translation statuses still eligible for automated LLM review and QA validation. */
export const PENDING_REVIEW_STATUS_SQL = `('draft', 'tm', 'fuzzy', 'auto')`;

/** Translation statuses included when mod-wide LLM verify runs with `force`. */
export const LLM_VERIFY_FORCE_STATUS_SQL = `('draft', 'tm', 'fuzzy', 'auto', 'reviewed', 'human')`;

/** SQL `IN (...)` list for mod-wide LLM verify row selection. */
export const llmVerifyEligibleStatusSql = (force: boolean): string =>
  force ? LLM_VERIFY_FORCE_STATUS_SQL : PENDING_REVIEW_STATUS_SQL;

/** Translation statuses that LLM translate/verify must never overwrite or re-process. */
export const LLM_PROTECTED_TRANSLATION_STATUS_SQL = `('reviewed', 'human', 'rejected')`;

/** How CLI / mod-wide LLM translate selects existing translations to overwrite. */
export type LlmTranslateOverwriteMode = 'default' | 'force' | 'force-all';

/** SQL predicate on LEFT JOIN translations t — combined with s.is_ignored = FALSE elsewhere. */
export const llmTranslateEligibilitySql = (mode: LlmTranslateOverwriteMode): string => {
  switch (mode) {
    case 'default':
      return 't.id IS NULL';
    case 'force':
      return `(t.id IS NULL OR t.status NOT IN ${LLM_PROTECTED_TRANSLATION_STATUS_SQL})`;
    case 'force-all':
      return 'TRUE';
  }
};

export const PENDING_REVIEW_STATUSES = new Set<TranslationStatus>(['draft', 'tm', 'fuzzy', 'auto']);
