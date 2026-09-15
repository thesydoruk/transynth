import type { GameId } from '../../types';
import type { LlmPromptFamily } from '../promptFamily';
import { gamePlugin } from '../../games/registry';

/** System prompt for Ukrainian game localization (per-game standalone prompts). */
export const buildUkrainianTranslateSystemPrompt = (
  _srcLang: string,
  game?: GameId | string | null,
  family?: LlmPromptFamily | null,
): string => gamePlugin(game).prompts.translateUk(family);

/** System prompt for Ukrainian localization quality audit (per-game standalone prompts). */
export const buildUkrainianVerifySystemPrompt = (
  _srcLang: string,
  game?: GameId | string | null,
  family?: LlmPromptFamily | null,
): string => gamePlugin(game).prompts.verifyUk(family);
