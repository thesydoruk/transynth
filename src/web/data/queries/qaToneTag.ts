/**
 * QA check for tone prompts on the dialogue wheel.
 *
 * A one-word player prompt such as "Sarcastic" says how the player answers,
 * not what they say, so the project writes it as a bracketed remark —
 * «[Сарказм]» — like "[Sarcasm]" inside a line. In the reviewed Fallout 4
 * corpus, machine translation left 242 of 431 such prompts bare, some as a
 * gendered adjective («Нетерплячий») that no player line may carry.
 */
import { findGamePlugin } from '../../../games/registry';
import type { QAIssueInput } from './qaHelpers';

/** Language whose bracket convention this is. */
const SUPPORTED_TARGET_LANG = 'uk';

const BRACKETED_RE = /^\s*\[[^\]]+\]\s*$/;

export const applyToneTagQaIssues = (
  issues: QAIssueInput[],
  source: string,
  translation: string,
  targetLang: string,
  field: string | null | undefined,
  game: string | null | undefined,
): void => {
  if (targetLang !== SUPPORTED_TARGET_LANG) return;
  const plugin = findGamePlugin(game);
  if (!plugin?.dialog?.isPlayerPromptField(field)) return;

  const word = source.trim().replace(/\.$/, '');
  if (!plugin.text.toneTagPrompts?.includes(word)) return;
  if (BRACKETED_RE.test(translation)) return;

  issues.push({
    issueType: 'tone_tag',
    severity: 'warning',
    message: `Tone prompt "${word}" is a remark, not a line: write it in brackets, e.g. [Сарказм].`,
  });
};
