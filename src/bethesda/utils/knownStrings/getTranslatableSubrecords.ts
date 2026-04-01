import type { GameType } from '../../../types';
import { TRANSLATABLE_SUBRECORDS_BY_GAME } from './constants';

/**
 * Return the translatable-subrecords map for the given game.
 */
export const getTranslatableSubrecords = (game: GameType): Record<string, Set<string>> => {
  return TRANSLATABLE_SUBRECORDS_BY_GAME[game];
};
