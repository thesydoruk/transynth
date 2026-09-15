import type { GameId } from '../../../types';
import { gamePlugin } from '../../../games/registry';
import { englishCommonRules, englishVerifyCommonRules } from './common/en';

export type { GamePromptRules as GameRules } from '../../../games/contract';

/**
 * Full English translation rules for a game.
 *
 * Games whose text has nothing in common with the shared bullet set (no
 * records, no item rarities) opt out of them via `english.useCommonRules`.
 */
export const buildEnglishTranslationRules = (
  targetLang: string,
  game?: GameId | string | null,
): string => {
  const { prompts } = gamePlugin(game);
  const gameRules = prompts.rules.en(targetLang);
  if (!prompts.english.useCommonRules) return gameRules.join('\n');
  return [...englishCommonRules(targetLang), '', ...gameRules].join('\n');
};

/** English rules block for verify-only prompts. */
export const buildEnglishVerifyTranslationRules = (
  targetLang: string,
  game?: GameId | string | null,
): string => {
  const { prompts } = gamePlugin(game);
  const gameRules = prompts.rules.en(targetLang);
  if (!prompts.english.useCommonRules) return gameRules.join('\n');
  return [...englishVerifyCommonRules(targetLang), '', ...gameRules].join('\n');
};

/** Game-specific verify audit bullets (English). */
export const buildEnglishVerifyGameNotes = (game?: GameId | string | null): string =>
  (gamePlugin(game).prompts.rules.verifyEn?.() ?? []).join('\n');
