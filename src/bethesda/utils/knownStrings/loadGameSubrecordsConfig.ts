import type { GameType } from '../../../types';
import { GAME_SUBRECORDS_CONFIG_BY_GAME, type GameSubrecordsConfig } from './constants';

/**
 * Load one game's subrecord configuration from JSON.
 */
export const loadGameSubrecordsConfig = (game: GameType): GameSubrecordsConfig => {
  const parsed = GAME_SUBRECORDS_CONFIG_BY_GAME[game];

  if (parsed.game !== game) {
    throw new Error(`Subrecord config mismatch: expected ${game}, got ${parsed.game}`);
  }

  return parsed;
};
