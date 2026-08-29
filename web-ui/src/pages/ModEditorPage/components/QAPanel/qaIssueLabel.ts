import type { TFunction } from 'i18next';

const RULE_TYPE_KEYS = new Set(['forbidden_chars', 'max_length']);

/** Localized QA issue type — rule types reuse qaRules keys. */
export const qaIssueTypeLabel = (issueType: string, t: TFunction): string => {
  if (RULE_TYPE_KEYS.has(issueType)) return t(`qaRules.${issueType}`);
  return t(`qa.types.${issueType}`, { defaultValue: issueType });
};
