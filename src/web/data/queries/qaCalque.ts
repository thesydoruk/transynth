/**
 * QA check for English constructions left standing in a Ukrainian translation.
 *
 * A calque passes every other check — it is grammatical, keeps the glossary,
 * and preserves the placeholders — so nothing else in the pipeline notices it.
 * It is a warning rather than an error: the phrase is understandable, it just
 * reads as translated.
 */
import { describeUkrainianCalques, findUkrainianCalques } from '../../../dialog';
import type { QAIssueInput } from './qaHelpers';

/** Language whose idiom the calque list describes. */
const SUPPORTED_TARGET_LANG = 'uk';

export const applyCalqueQaIssues = (
  issues: QAIssueInput[],
  translation: string,
  targetLang: string,
): void => {
  if (targetLang !== SUPPORTED_TARGET_LANG) return;

  const matches = findUkrainianCalques(translation);
  if (matches.length === 0) return;

  issues.push({
    issueType: 'calque',
    severity: 'warning',
    message: `Calque: ${describeUkrainianCalques(matches)}.`,
  });
};
