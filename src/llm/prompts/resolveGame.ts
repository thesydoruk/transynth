import type { GameType } from '../../types';

const GAME_TYPES = new Set<GameType>(['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle']);

/** Resolve prompt game id; defaults to Fallout 4 when unknown. */
export const resolveGameType = (game?: GameType | string | null): GameType => {
  if (game != null && game !== '' && GAME_TYPES.has(game as GameType)) {
    return game as GameType;
  }
  return 'fo4';
};
