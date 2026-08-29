import type { GameType } from '../../../types';
import { englishCommonRules, englishVerifyCommonRules } from './common/en';
import { GAME_RULES } from './games';
import { isDiscoGame, resolveGameType } from '../resolveGame';

export { resolveGameType } from '../resolveGame';
export type { GameRules } from './types';

/** Full English translation rules block for translate/verify prompts. */
export const buildEnglishTranslationRules = (
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const resolved = resolveGameType(game);
  const gameRules = GAME_RULES[resolved].en(targetLang);
  if (isDiscoGame(resolved)) return gameRules.join('\n');
  return [...englishCommonRules(targetLang), '', ...gameRules].join('\n');
};

/** English rules block for verify-only prompts. */
export const buildEnglishVerifyTranslationRules = (
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const resolved = resolveGameType(game);
  const gameRules = GAME_RULES[resolved].en(targetLang);
  if (isDiscoGame(resolved)) return gameRules.join('\n');
  return [...englishVerifyCommonRules(targetLang), '', ...gameRules].join('\n');
};

/** Game-specific verify audit bullets (English). */
export const buildEnglishVerifyGameNotes = (game?: GameType | string | null): string => {
  const resolved = resolveGameType(game);
  const notes = GAME_RULES[resolved].verifyEn?.() ?? [];
  if (notes.length === 0) return '';
  return notes.join('\n');
};
