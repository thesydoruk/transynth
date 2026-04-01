import type { GameType } from '../../../types';
import { IGNORED_RECORDS_BY_GAME } from './constants';

/**
 * Returns true when the record is explicitly treated as ignored for the game.
 */
export const isIgnoredRecord = (recSig: string, game: GameType): boolean => {
  return IGNORED_RECORDS_BY_GAME[game]?.has(recSig) ?? false;
};
