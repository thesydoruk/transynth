import type { GameType } from '../types';
import fo3Keywords from './function-keywords/fo3.json' with { type: 'json' };
import fo4Keywords from './function-keywords/fo4.json' with { type: 'json' };
import fnvKeywords from './function-keywords/fnv.json' with { type: 'json' };
import sseKeywords from './function-keywords/sse.json' with { type: 'json' };
import sleKeywords from './function-keywords/sle.json' with { type: 'json' };

const FUNCTION_KEYWORDS_BY_GAME: Record<GameType, readonly string[]> = {
  fo3: fo3Keywords,
  fo4: fo4Keywords,
  fo76: fo4Keywords,
  fnv: fnvKeywords,
  ob: fo3Keywords,
  mw: fo3Keywords,
  sse: sseKeywords,
  sle: sleKeywords,
  disco: [],
};

/**
 * Return the legacy FunctionKeywords corpus for a supported game.
 * Fallout 76 intentionally reuses the Fallout 4 keyword set.
 *
 * @param game - Active game identifier.
 * @returns Ordered keyword list for that game, or an empty array when absent.
 */
export const getFunctionKeywordsForGame = (game?: GameType | null): readonly string[] => {
  if (!game) return [];
  return FUNCTION_KEYWORDS_BY_GAME[game] ?? [];
};
